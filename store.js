/* ═════════════════════════════════════════════════════════
   BLACK TREE — local-first data store.

   Every read the app does (dashboard totals, entry lists, goal
   progress) comes from a JSON snapshot in localStorage, never
   straight from the network — so once that snapshot exists, the
   whole app (viewing AND adding entries) keeps working with no
   connection at all. Writes apply to the local snapshot immediately
   and are queued; btSync() replays the queue and refreshes the
   snapshot whenever a connection is actually available.
   ═════════════════════════════════════════════════════════ */

const btStoreKey = (uid) => `bt_store_${uid}`;
const btQueueKey = (uid) => `bt_queue_${uid}`;

function btEmptyStore() {
  return { profile: null, goals: [], liabilities: [], income: [], expenses: [], syncedAt: null };
}

function btLoadStore(uid) {
  try {
    const raw = localStorage.getItem(btStoreKey(uid));
    return raw ? JSON.parse(raw) : btEmptyStore();
  } catch (e) { return btEmptyStore(); }
}

function btSaveStore(uid, store) {
  localStorage.setItem(btStoreKey(uid), JSON.stringify(store));
}

function btLoadQueue(uid) {
  try {
    const raw = localStorage.getItem(btQueueKey(uid));
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function btSaveQueue(uid, queue) {
  localStorage.setItem(btQueueKey(uid), JSON.stringify(queue));
}

const BT_TABLE_TO_STORE_KEY = {
  bt_income_entries: "income",
  bt_expense_entries: "expenses",
  bt_goals: "goals",
  bt_liabilities: "liabilities"
};

/**
 * Queue a write (insert/update/delete) and apply it to the local
 * snapshot right away so the UI reflects it instantly, offline or not.
 */
function btQueueWrite(uid, table, op, payload, id) {
  const store = btLoadStore(uid);
  const key = BT_TABLE_TO_STORE_KEY[table];
  const tempId = id || (self.crypto?.randomUUID ? crypto.randomUUID() : "tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2));

  if (op === "insert") {
    store[key].unshift({ ...payload, id: tempId, user_id: uid, _pending: true });
  } else if (op === "update") {
    const idx = store[key].findIndex((r) => r.id === id);
    if (idx >= 0) store[key][idx] = { ...store[key][idx], ...payload, _pending: true };
  } else if (op === "delete") {
    store[key] = store[key].filter((r) => r.id !== id);
  }
  btSaveStore(uid, store);

  const queue = btLoadQueue(uid);
  queue.push({ op, table, id: op === "insert" ? tempId : id, isTemp: op === "insert", payload: payload || null });
  btSaveQueue(uid, queue);

  btSyncSoon(uid);
  return tempId;
}

const btAddIncome = (uid, payload) => btQueueWrite(uid, "bt_income_entries", "insert", payload);
const btAddExpense = (uid, payload) => btQueueWrite(uid, "bt_expense_entries", "insert", payload);
const btAddGoal = (uid, payload) => btQueueWrite(uid, "bt_goals", "insert", payload);
const btAddLiability = (uid, payload) => btQueueWrite(uid, "bt_liabilities", "insert", payload);
const btUpdateGoal = (uid, id, payload) => btQueueWrite(uid, "bt_goals", "update", payload, id);
const btUpdateLiability = (uid, id, payload) => btQueueWrite(uid, "bt_liabilities", "update", payload, id);
const btDeleteEntry = (uid, table, id) => btQueueWrite(uid, table, "delete", null, id);

/** bt_profiles is a single object per user, not an array — handled separately from btQueueWrite. */
function btUpdateProfile(uid, payload) {
  const store = btLoadStore(uid);
  store.profile = { ...store.profile, ...payload };
  btSaveStore(uid, store);

  const queue = btLoadQueue(uid);
  queue.push({ op: "update", table: "bt_profiles", id: uid, isTemp: false, payload });
  btSaveQueue(uid, queue);

  btSyncSoon(uid);
}

let btSyncTimer = null;
function btSyncSoon(uid) {
  if (btSyncTimer) clearTimeout(btSyncTimer);
  btSyncTimer = setTimeout(() => btSync(uid), 400);
}

let btSyncInFlight = false;
/**
 * Replay the pending queue against Supabase, then pull a fresh
 * snapshot. Safe to call anytime — no-ops quietly when offline or
 * when a sync is already running.
 */
async function btSync(uid) {
  if (!uid || !navigator.onLine || btSyncInFlight) return { ok: false, reason: "unavailable" };
  btSyncInFlight = true;
  try {
    let queue = btLoadQueue(uid);
    const idMap = {}; // tempId -> real id, for chaining goal_id/liability_id set in the same batch

    while (queue.length) {
      const job = queue[0];
      const table = job.table;
      let payload = job.payload;
      if (payload && payload.goal_id && idMap[payload.goal_id]) payload = { ...payload, goal_id: idMap[payload.goal_id] };
      if (payload && payload.liability_id && idMap[payload.liability_id]) payload = { ...payload, liability_id: idMap[payload.liability_id] };

      try {
        if (job.op === "insert") {
          const { data, error } = await btSupabase.from(table).insert({ ...payload, user_id: uid }).select().single();
          if (error) throw error;
          idMap[job.id] = data.id;
        } else if (job.op === "update") {
          const realId = idMap[job.id] || job.id;
          const { error } = await btSupabase.from(table).update(payload).eq("id", realId);
          if (error) throw error;
        } else if (job.op === "delete") {
          const realId = idMap[job.id] || job.id;
          if (!job.isTemp) {
            const { error } = await btSupabase.from(table).delete().eq("id", realId);
            if (error) throw error;
          }
        }
        queue.shift();
        btSaveQueue(uid, queue);
      } catch (err) {
        // Network failure (fetch throws / no status) -> stop, retry later.
        // A real API error (validation, RLS) -> drop this one job so it
        // can't block everything behind it forever, and move on.
        const isNetworkError = err instanceof TypeError || err?.message === "Failed to fetch";
        if (isNetworkError || !navigator.onLine) { btSyncInFlight = false; return { ok: false, reason: "offline" }; }
        console.error("Black Tree sync: dropping failed job", job, err);
        queue.shift();
        btSaveQueue(uid, queue);
      }
    }

    await btPullSnapshot(uid);
    return { ok: true };
  } finally {
    btSyncInFlight = false;
  }
}

/** Overwrite the local snapshot with the server's current state for this user. */
async function btPullSnapshot(uid) {
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const since = twoYearsAgo.toISOString().slice(0, 10);

  const [profileRes, goalsRes, liabilitiesRes, incomeRes, expenseRes] = await Promise.all([
    btSupabase.from("bt_profiles").select("*").eq("id", uid).single(),
    btSupabase.from("bt_goals").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    btSupabase.from("bt_liabilities").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    btSupabase.from("bt_income_entries").select("*").eq("user_id", uid).gte("entry_date", since).order("entry_date", { ascending: false }),
    btSupabase.from("bt_expense_entries").select("*").eq("user_id", uid).gte("expense_date", since).order("expense_date", { ascending: false })
  ]);

  const store = {
    profile: profileRes.data || null,
    goals: goalsRes.data || [],
    liabilities: liabilitiesRes.data || [],
    income: incomeRes.data || [],
    expenses: expenseRes.data || [],
    syncedAt: new Date().toISOString()
  };
  btSaveStore(uid, store);
  return store;
}

window.addEventListener("online", () => {
  const uid = window.btCurrentUserId;
  if (uid) btSync(uid);
});

/* ── Calculations — pure functions over the local snapshot, so every
   number on the dashboard works identically online or offline. ── */

const BT_FREQ_TO_MONTHLY = { "Weekly": 52 / 12, "Bi-Weekly": 26 / 12, "Monthly": 1, "Annually": 1 / 12, "One-time": 0 };

function btDateInRange(dateStr, start, end) {
  return dateStr >= start && dateStr <= end;
}

function btSumInRange(entries, dateField, start, end) {
  return entries.filter((e) => btDateInRange(e[dateField], start, end)).reduce((s, e) => s + Number(e.amount), 0);
}

function btPeriodBounds(today = new Date()) {
  const d = new Date(today);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(d); weekStart.setDate(d.getDate() - dow);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const fmt = (x) => x.toISOString().slice(0, 10);
  const todayStr = fmt(d);
  return {
    week: { start: fmt(weekStart), end: todayStr },
    month: { start: fmt(monthStart), end: todayStr },
    ytd: { start: fmt(yearStart), end: todayStr }
  };
}

/** Estimated annual gross income: simple run-rate off YTD actuals (falls back to 0 with no data yet). */
function btEstimateAnnualIncome(store, today = new Date()) {
  const { ytd } = btPeriodBounds(today);
  const ytdTotal = btSumInRange(store.income, "entry_date", ytd.start, ytd.end);
  const dayOfYear = Math.max(1, Math.ceil((today - new Date(today.getFullYear(), 0, 0)) / 86400000));
  if (ytdTotal > 0) return (ytdTotal / dayOfYear) * 365;
  // No actuals yet — fall back to frequency-normalized planned income.
  return store.income.reduce((s, e) => s + Number(e.amount) * (BT_FREQ_TO_MONTHLY[e.frequency] || 0) * 12, 0);
}

function btDashboardSummary(store, today = new Date()) {
  const periods = btPeriodBounds(today);
  const out = {};
  for (const key of ["week", "month", "ytd"]) {
    const { start, end } = periods[key];
    const income = btSumInRange(store.income, "entry_date", start, end);
    const expenses = btSumInRange(store.expenses, "expense_date", start, end);
    out[key] = { income, expenses, net: income - expenses };
  }
  const annualIncomeEstimate = btEstimateAnnualIncome(store, today);
  const targetPct = store.profile?.annual_savings_target_pct ?? 0.20;
  const annualSavingsTarget = annualIncomeEstimate * targetPct;
  const ytdSavingsActual = store.expenses
    .filter((e) => e.category === "Savings & Investments" && btDateInRange(e.expense_date, periods.ytd.start, periods.ytd.end))
    .reduce((s, e) => s + Number(e.amount), 0);

  return { periods: out, annualIncomeEstimate, annualSavingsTarget, ytdSavingsActual, targetPct };
}

function btGoalProgress(store) {
  return store.goals.map((g) => {
    const contributed = store.expenses.filter((e) => e.goal_id === g.id).reduce((s, e) => s + Number(e.amount), 0);
    const saved = Number(g.opening_amount || 0) + contributed;
    return { ...g, saved_amount: saved, progress_pct: g.target_amount > 0 ? Math.min(1, saved / g.target_amount) : 0 };
  });
}

function btLiabilityProgress(store) {
  return store.liabilities.map((l) => {
    const paid = store.expenses.filter((e) => e.liability_id === l.id).reduce((s, e) => s + Number(e.amount), 0);
    return { ...l, paid_via_tracker: paid, estimated_remaining: Math.max(0, Number(l.current_balance) - paid) };
  });
}

/** Red/Yellow/Green health flags, thresholds straight from the source spreadsheet's guideline sheets. */
function btHealthFlags(store, summary) {
  const T = BT_CONFIG.THRESHOLDS;
  const flags = [];
  const monthNet = summary.periods.month.net;
  const monthIncome = summary.periods.month.income;

  if (monthIncome > 0) {
    const netPct = monthNet / monthIncome;
    if (monthNet < 0) flags.push({ level: "red", text: "You're spending more than you're earning this month — book a consultation." });
    else if (netPct < T.cashFlowYellowPct) flags.push({ level: "yellow", text: "What's left over this month is thin (under 5% of income)." });
    else if (netPct >= T.cashFlowGreenPct) flags.push({ level: "green", text: "Healthy surplus this month — on track." });

    const debtThisMonth = btSumInRange(store.expenses, "expense_date", summary.periods.month.start, summary.periods.month.end);
    const debtPaid = store.expenses.filter((e) => e.category === "Debt Repayment" && btDateInRange(e.expense_date, summary.periods.month.start, summary.periods.month.end)).reduce((s, e) => s + Number(e.amount), 0);
    const debtRatio = debtPaid / monthIncome;
    if (debtRatio > T.debtRatioRed) flags.push({ level: "red", text: "Debt payments are over 40% of income this month." });
    else if (debtRatio > T.debtRatioYellow) flags.push({ level: "yellow", text: "Debt payments are 20–40% of income this month." });

    const housingPaid = store.expenses.filter((e) => e.category === "Housing" && btDateInRange(e.expense_date, summary.periods.month.start, summary.periods.month.end)).reduce((s, e) => s + Number(e.amount), 0);
    if (housingPaid / monthIncome > T.housingRatioRed) flags.push({ level: "red", text: "Housing costs are over 30% of income this month." });
  }

  if (summary.annualIncomeEstimate > 0) {
    const rate = summary.ytdSavingsActual / summary.annualIncomeEstimate;
    if (rate >= T.savingsRateGreen) flags.push({ level: "green", text: "Savings rate is 20%+ of income — on track for financial independence." });
    else if (rate >= T.savingsRateYellow) flags.push({ level: "yellow", text: "Savings rate is 10–20% of income." });
    else flags.push({ level: "red", text: "Savings rate is under 10% of income — book a consultation." });
  }

  return flags;
}
