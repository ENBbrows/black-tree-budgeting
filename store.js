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
  return { profile: null, goals: [], liabilities: [], bills: [], income: [], expenses: [], syncedAt: null };
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
  bt_liabilities: "liabilities",
  bt_recurring_bills: "bills"
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
const btAddBill = (uid, payload) => btQueueWrite(uid, "bt_recurring_bills", "insert", payload);
const btUpdateGoal = (uid, id, payload) => btQueueWrite(uid, "bt_goals", "update", payload, id);
const btUpdateLiability = (uid, id, payload) => btQueueWrite(uid, "bt_liabilities", "update", payload, id);
const btUpdateBill = (uid, id, payload) => btQueueWrite(uid, "bt_recurring_bills", "update", payload, id);
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
      if (payload && payload.bill_id && idMap[payload.bill_id]) payload = { ...payload, bill_id: idMap[payload.bill_id] };

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

  const [profileRes, goalsRes, liabilitiesRes, billsRes, incomeRes, expenseRes] = await Promise.all([
    btSupabase.from("bt_profiles").select("*").eq("id", uid).single(),
    btSupabase.from("bt_goals").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    btSupabase.from("bt_liabilities").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    btSupabase.from("bt_recurring_bills").select("*").eq("user_id", uid).order("day_of_month", { ascending: true }),
    btSupabase.from("bt_income_entries").select("*").eq("user_id", uid).gte("entry_date", since).order("entry_date", { ascending: false }),
    btSupabase.from("bt_expense_entries").select("*").eq("user_id", uid).gte("expense_date", since).order("expense_date", { ascending: false })
  ]);

  const store = {
    profile: profileRes.data || null,
    goals: goalsRes.data || [],
    liabilities: liabilitiesRes.data || [],
    bills: billsRes.data || [],
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

/** Escapes text before it's interpolated into an innerHTML template — every field a client controls (full_name, notes, descriptions, ...) needs this wherever it's rendered outside the page that field itself belongs to. */
function btEscapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function btSumInRange(entries, dateField, start, end) {
  return entries.filter((e) => btDateInRange(e[dateField], start, end)).reduce((s, e) => s + Number(e.amount), 0);
}

/* ── Multi-currency: every rate is manual (client-set in Settings), never
   fetched live, so conversion works fully offline like everything else. ── */

/**
 * Guesses an expense category from free text (what the client typed, or
 * OCR'd bill text) via simple keyword matching — always a starting point
 * to confirm or change, never applied without the client seeing it.
 * Returns null if nothing matched.
 */
function btGuessCategory(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const dict = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.CATEGORY_KEYWORDS) || {};
  for (const [category, keywords] of Object.entries(dict)) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return null;
}

/** Same idea as btGuessCategory, but for how the bill says it was paid (card network, "cash tendered", etc). */
function btGuessPaymentType(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const dict = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.PAYMENT_KEYWORDS) || {};
  for (const [type, keywords] of Object.entries(dict)) {
    if (keywords.some((k) => lower.includes(k))) return type;
  }
  return null;
}

/**
 * Pulls the most likely total amount out of OCR'd receipt/bill text.
 * Prefers a number on a line mentioning "total"/"amount due"/"balance";
 * falls back to the largest currency-looking number found anywhere.
 */
function btGuessAmountFromText(text) {
  if (!text) return null;
  const numRe = /(\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?)/g;
  const lines = text.split(/\r?\n/);
  // \btotal\b (not "amount due"/"balance due") deliberately excludes "Subtotal" —
  // searching from the bottom favors the grand total over any subtotal line above it.
  const keywordRe = /\btotal\b|amount due|balance due/i;
  const keywordLine = [...lines].reverse().find((l) => keywordRe.test(l));
  const parseNums = (s) => (s.match(numRe) || []).map((n) => parseFloat(n.replace(/,/g, ""))).filter((n) => !isNaN(n) && n > 0);

  if (keywordLine) {
    const nums = parseNums(keywordLine);
    if (nums.length) return Math.max(...nums);
  }
  const allNums = parseNums(text);
  return allNums.length ? Math.max(...allNums) : null;
}

const BT_MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Pulls a date out of OCR'd receipt/bill text, returned as YYYY-MM-DD.
 * Tries ISO (2026-01-05), "5 Jan 2026" / "Jan 5, 2026", then a bare
 * numeric d/m/y or m/d/y — whichever part can't be a month (>12) settles
 * which it is; a genuinely ambiguous pair assumes day/month/year, the
 * convention on most bills here. Returns null if nothing looks like a
 * date, so the caller can fall back to today.
 */
function btGuessDateFromText(text) {
  if (!text) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const fullYear = (y) => (String(y).length === 2 ? (Number(y) > 70 ? "19" + y : "20" + y) : String(y));
  const monthNum = (name) => BT_MONTH_NAMES.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;
  const monthRe = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";

  const iso = text.match(/\b(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    if (valid(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }

  const monthDayYear = text.match(new RegExp(`\\b${monthRe}\\s+(\\d{1,2}),?\\s+(\\d{2,4})\\b`, "i"));
  if (monthDayYear) {
    const m = monthNum(monthDayYear[1]), d = +monthDayYear[2], y = +fullYear(monthDayYear[3]);
    if (valid(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }

  const dayMonthYear = text.match(new RegExp(`\\b(\\d{1,2})\\s+${monthRe},?\\s+(\\d{2,4})\\b`, "i"));
  if (dayMonthYear) {
    const d = +dayMonthYear[1], m = monthNum(dayMonthYear[2]), y = +fullYear(dayMonthYear[3]);
    if (valid(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }

  const slash = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (slash) {
    const y = +fullYear(slash[3]);
    const a = +slash[1], b = +slash[2];
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    else { day = a; month = b; }
    if (valid(y, month, day)) return `${y}-${pad(month)}-${pad(day)}`;
  }

  return null;
}

/**
 * Best-effort merchant/location guess from OCR'd receipt text — receipts
 * almost always lead with the business name, so this returns the first
 * non-empty line that isn't obviously boilerplate (address/phone/website,
 * "receipt", "invoice", ...) or a bare number/date/phone-looking string.
 */
function btGuessMerchantFromText(text) {
  if (!text) return null;
  const skipRe = /^\s*(receipt|invoice|tax invoice|customer copy|thank you|tel|phone|www\.|http)/i;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (skipRe.test(line)) continue;
    if (/^[\d\s\-\/.,:]+$/.test(line)) continue;
    const letters = line.replace(/[^a-zA-Z]/g, "");
    if (letters.length < 3) continue;
    return line.length > 60 ? line.slice(0, 60) : line;
  }
  return null;
}

/* ── Shared bill/receipt OCR — used by both the Expense page's own scan
   button and the Dashboard's "Scan a Bill" shortcut, so the Tesseract
   loading and text-guessing logic lives in exactly one place. ── */
let btScanLib = null;
async function btLoadScanLib() {
  if (btScanLib) return btScanLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  btScanLib = window.Tesseract;
  return btScanLib;
}

/**
 * Runs OCR on a bill/receipt image — a File/Blob or a data URL string,
 * Tesseract accepts either — and returns best-guess fields. onProgress,
 * if given, is called with a 0–1 fraction while text recognition runs.
 */
async function btScanBillImage(file, onProgress) {
  const Tesseract = await btLoadScanLib();
  const { data } = await Tesseract.recognize(file, "eng", {
    logger: (m) => { if (m.status === "recognizing text" && onProgress) onProgress(m.progress || 0); }
  });
  const text = data.text || "";
  return {
    amount: btGuessAmountFromText(text),
    date: btGuessDateFromText(text),
    merchant: btGuessMerchantFromText(text),
    category: btGuessCategory(text),
    paymentType: btGuessPaymentType(text)
  };
}

/**
 * Wires a floating "scan a bill" button (plus its paired hidden file
 * input, both found by id) present on Dashboard/Income/Statement/
 * Protection: tap it, take or pick a photo, it's read on-device via
 * btScanBillImage, and the guessed fields hand off to Log Expense via
 * sessionStorage — never the photo itself, since a script can't reopen
 * a file/camera picker after a navigation without a fresh tap, and a
 * full photo risks sessionStorage's size limit anyway. No-ops if either
 * element isn't on the current page.
 */
function btWireScanFab(btnId, fileId) {
  const btn = document.getElementById(btnId);
  const fileInput = document.getElementById(fileId);
  if (!btn || !fileInput) return;
  const idleLabel = btn.textContent;
  btn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    btn.disabled = true;
    btn.textContent = "⏳";
    try {
      const guess = await btScanBillImage(file);
      sessionStorage.setItem("bt_scan_pending", JSON.stringify(guess));
      window.location.href = "expense.html";
    } catch (err) {
      console.error("Black Tree bill scan failed", err);
      btn.disabled = false;
      btn.textContent = idleLabel;
      if (typeof toast === "function") toast("Couldn't read that image — try again or enter it manually.");
    }
  });
}

/* ── Document Library — private accounting records (bank-transfer
   screenshots, bill/receipt photos) kept in the "bt-documents" Storage
   bucket, one file per bt_documents row. The bucket is private; every
   read goes through a short-lived signed URL rather than a public
   link, and every object's path is prefixed with the owner's uid so
   Storage's own RLS policies enforce that only they can reach it. ── */

function btDocStoragePath(uid, docId, file) {
  const rawExt = (file.name || "").split(".").pop() || "jpg";
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${uid}/${docId}.${ext}`;
}

/** Uploads a document image and inserts its metadata row. meta: {doc_type, bank_name, category, amount, doc_date, notes, income_id, expense_id}. Rolls back the upload if the row insert fails. */
async function btUploadDocument(uid, file, meta) {
  const docId = self.crypto?.randomUUID ? crypto.randomUUID() : "doc-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const path = btDocStoragePath(uid, docId, file);
  const { error: uploadError } = await btSupabase.storage.from("bt-documents").upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
  if (uploadError) throw uploadError;
  const row = { id: docId, user_id: uid, storage_path: path, ...meta };
  const { data, error } = await btSupabase.from("bt_documents").insert(row).select().single();
  if (error) {
    await btSupabase.storage.from("bt-documents").remove([path]).catch(() => {});
    throw error;
  }
  return data;
}

/** Every document row for this user — small metadata only, so sorting/filtering/grouping happens client-side against the full list. */
async function btListDocuments(uid) {
  const { data, error } = await btSupabase.from("bt_documents").select("*").eq("user_id", uid).order("doc_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function btDeleteDocument(doc) {
  await btSupabase.storage.from("bt-documents").remove([doc.storage_path]).catch(() => {});
  const { error } = await btSupabase.from("bt_documents").delete().eq("id", doc.id);
  if (error) throw error;
}

/** Short-lived (1hr) signed URLs for a batch of documents, keyed by storage_path — the only way to actually view an image, since the bucket is private. */
async function btDocumentSignedUrls(paths) {
  if (!paths.length) return {};
  const { data, error } = await btSupabase.storage.from("bt-documents").createSignedUrls(paths, 3600);
  if (error || !data) return {};
  const map = {};
  data.forEach((d, i) => { if (d.signedUrl) map[d.path || paths[i]] = d.signedUrl; });
  return map;
}

/** Sorts a document list by the chosen key — returns a new array, never mutates the input. */
function btSortDocuments(docs, sortBy) {
  const list = docs.slice();
  const byDateDesc = (a, b) => b.doc_date.localeCompare(a.doc_date);
  switch (sortBy) {
    case "bank_asc": return list.sort((a, b) => (a.bank_name || "").localeCompare(b.bank_name || "") || byDateDesc(a, b));
    case "date_asc": return list.sort((a, b) => a.doc_date.localeCompare(b.doc_date));
    case "datetime_desc": return list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    case "datetime_asc": return list.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    case "price_desc": return list.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
    case "price_asc": return list.sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
    case "category_asc": return list.sort((a, b) => (a.category || "").localeCompare(b.category || "") || byDateDesc(a, b));
    case "date_desc":
    default:
      return list.sort(byDateDesc);
  }
}

/** Groups an already-sorted document list by the chosen key, preserving each group's internal order. Returns [{label, docs}], groups in first-seen order. */
function btGroupDocuments(docs, groupBy) {
  if (groupBy === "none" || !groupBy) return [{ label: null, docs }];
  const keyOf = (d) => {
    if (groupBy === "bank") return d.bank_name || "No bank listed";
    if (groupBy === "category") return d.category || "Uncategorized";
    if (groupBy === "month") {
      const dt = new Date(d.doc_date + "T00:00:00");
      return dt.toLocaleString(undefined, { month: "long", year: "numeric" });
    }
    if (groupBy === "week") {
      const dt = new Date(d.doc_date + "T00:00:00");
      const weekStart = new Date(dt);
      weekStart.setDate(dt.getDate() - dt.getDay());
      return "Week of " + weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }
    return "";
  };
  const order = [];
  const groups = {};
  docs.forEach((d) => {
    const key = keyOf(d);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(d);
  });
  return order.map((label) => ({ label, docs: groups[label] }));
}

/** Currencies a client can pick from: their home currency first, then the configured extras. */
function btCurrencyOptions(profile) {
  const home = profile?.currency || "TTD";
  const extra = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.EXTRA_CURRENCIES) || [];
  return [home, ...extra.filter((c) => c !== home)];
}

/** Converts one amount between currencies via the client's manual fx_rates (foreign -> home). `ok:false` means a needed rate isn't set — value is a best-effort passthrough, not a real conversion. */
function btConvertAmount(amount, fromCurrency, toCurrency, profile) {
  const home = profile?.currency || "TTD";
  if (fromCurrency === toCurrency) return { value: amount, ok: true };
  const rates = profile?.fx_rates || {};
  let inHome = amount, ok = true;
  if (fromCurrency !== home) {
    const r = rates[fromCurrency];
    if (r) inHome = amount * r; else ok = false;
  }
  if (toCurrency === home) return { value: inHome, ok };
  const r2 = rates[toCurrency];
  if (!r2) return { value: inHome, ok: false };
  return { value: inHome / r2, ok };
}

function btSumIncomeInRange(entries, start, end, viewCurrency, profile) {
  const home = profile?.currency || "TTD";
  let total = 0, unconverted = 0;
  entries.forEach((e) => {
    if (!btDateInRange(e.entry_date, start, end)) return;
    const { value, ok } = btConvertAmount(Number(e.amount), e.currency || home, viewCurrency, profile);
    total += value;
    if (!ok) unconverted++;
  });
  return { total, unconverted };
}

function btSumExpensesInRange(entries, start, end, viewCurrency, profile) {
  const home = profile?.currency || "TTD";
  let total = 0, unconverted = 0;
  entries.forEach((e) => {
    if (!btDateInRange(e.expense_date, start, end)) return;
    const { value, ok } = btConvertAmount(Number(e.amount), home, viewCurrency, profile);
    total += value;
    if (!ok) unconverted++;
  });
  return { total, unconverted };
}

function btSumExpenseCategoryInRange(entries, category, start, end, viewCurrency, profile) {
  const home = profile?.currency || "TTD";
  return entries
    .filter((e) => e.category === category && btDateInRange(e.expense_date, start, end))
    .reduce((s, e) => s + btConvertAmount(Number(e.amount), home, viewCurrency, profile).value, 0);
}

/** Expenses in range, grouped by payment_type ("Cash", "Credit Card", ...) and converted into viewCurrency — shows where money actually left from, not just what it went toward. Entries with no payment type recorded land under "Not specified". */
function btExpensesByPaymentMethod(entries, start, end, viewCurrency, profile) {
  const home = profile?.currency || "TTD";
  const totals = {};
  entries.forEach((e) => {
    if (!btDateInRange(e.expense_date, start, end)) return;
    const { value } = btConvertAmount(Number(e.amount), home, viewCurrency, profile);
    const key = e.payment_type || "Not specified";
    totals[key] = (totals[key] || 0) + value;
  });
  return totals;
}

/** Income entries in range, grouped by source and converted into viewCurrency — feeds the cash flow statement. */
function btIncomeBreakdownBySource(entries, start, end, viewCurrency, profile) {
  const home = profile?.currency || "TTD";
  const totals = {};
  entries.forEach((e) => {
    if (!btDateInRange(e.entry_date, start, end)) return;
    const { value } = btConvertAmount(Number(e.amount), e.currency || home, viewCurrency, profile);
    totals[e.source] = (totals[e.source] || 0) + value;
  });
  return totals;
}

/** Raw (unconverted) income totals grouped by their own entry currency — the "per-currency" view alongside the unified one. */
function btIncomeBreakdownByCurrency(store, start, end) {
  const home = store.profile?.currency || "TTD";
  const totals = {};
  store.income.forEach((e) => {
    if (!btDateInRange(e.entry_date, start, end)) return;
    const cur = e.currency || home;
    totals[cur] = (totals[cur] || 0) + Number(e.amount);
  });
  return totals;
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

/** Estimated annual gross income (in viewCurrency): simple run-rate off YTD actuals (falls back to frequency-normalized planned income with no actuals yet). */
function btEstimateAnnualIncome(store, viewCurrency, today = new Date()) {
  const profile = store.profile;
  const vc = viewCurrency || profile?.currency || "TTD";
  const { ytd } = btPeriodBounds(today);
  const { total: ytdTotal } = btSumIncomeInRange(store.income, ytd.start, ytd.end, vc, profile);
  const dayOfYear = Math.max(1, Math.ceil((today - new Date(today.getFullYear(), 0, 0)) / 86400000));
  if (ytdTotal > 0) return (ytdTotal / dayOfYear) * 365;
  return store.income.reduce((s, e) => {
    const { value } = btConvertAmount(Number(e.amount), e.currency || profile?.currency || "TTD", vc, profile);
    return s + value * (BT_FREQ_TO_MONTHLY[e.frequency] || 0) * 12;
  }, 0);
}

/**
 * The single annual-income figure every protection/retirement calculation
 * keys off: the client's own fixed profile.annual_income from Settings
 * when they've set one, else the year-to-date estimate above. Emergency
 * Fund, Critical Illness Fund, Life Insurance, and Retirement Target all
 * call this rather than each picking their own income source, so they
 * stay consistent with each other and with whatever the client actually
 * told the app their income is.
 */
function btAnnualIncomeBasis(store, viewCurrency, today = new Date()) {
  const profile = store.profile;
  const vc = viewCurrency || profile?.currency || "TTD";
  if (Number(profile?.annual_income) > 0) {
    const { value } = btConvertAmount(Number(profile.annual_income), profile?.currency || "TTD", vc, profile);
    return { annualIncome: value, isFixed: true };
  }
  return { annualIncome: btEstimateAnnualIncome(store, vc, today), isFixed: false };
}

/** All figures converted into viewCurrency (defaults to the client's home currency) via their manual fx_rates. */
function btDashboardSummary(store, viewCurrency, today = new Date()) {
  const profile = store.profile;
  const vc = viewCurrency || profile?.currency || "TTD";
  const periods = btPeriodBounds(today);
  const out = {};
  let hasUnconverted = false;
  for (const key of ["week", "month", "ytd"]) {
    const { start, end } = periods[key];
    const inc = btSumIncomeInRange(store.income, start, end, vc, profile);
    const exp = btSumExpensesInRange(store.expenses, start, end, vc, profile);
    if (inc.unconverted || exp.unconverted) hasUnconverted = true;
    out[key] = { income: inc.total, expenses: exp.total, net: inc.total - exp.total, start, end };
  }
  const annualIncomeEstimate = btEstimateAnnualIncome(store, vc, today);
  const targetPct = profile?.annual_savings_target_pct ?? 0.20;
  const annualSavingsTarget = annualIncomeEstimate * targetPct;
  const ytdSavingsActual = btSumExpenseCategoryInRange(store.expenses, "Savings & Investments", periods.ytd.start, periods.ytd.end, vc, profile);

  return { viewCurrency: vc, hasUnconverted, periods: out, annualIncomeEstimate, annualSavingsTarget, ytdSavingsActual, targetPct };
}

function btGoalProgress(store) {
  return store.goals.map((g) => {
    const contributed = store.expenses.filter((e) => e.goal_id === g.id).reduce((s, e) => s + Number(e.amount), 0);
    const saved = Number(g.opening_amount || 0) + contributed;
    return { ...g, saved_amount: saved, progress_pct: g.target_amount > 0 ? Math.min(1, saved / g.target_amount) : 0 };
  });
}

/**
 * Debt progress, plus — when a target_payoff_date is set — a pace reading
 * so "60% paid off" also comes with "on track" or "behind": expected
 * progress is elapsed time / total time from when the debt was added to
 * its target date, compared against actual amount paid via the tracker.
 */
function btLiabilityProgress(store, today = new Date()) {
  const todayStr = today.toISOString().slice(0, 10);
  return store.liabilities.map((l) => {
    const linkedExpenses = store.expenses.filter((e) => e.liability_id === l.id);
    const paid = linkedExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const estimated_remaining = Math.max(0, Number(l.current_balance) - paid);
    const result = { ...l, paid_via_tracker: paid, estimated_remaining };

    if (l.target_payoff_date) {
      const startStr = (l.created_at || todayStr).slice(0, 10);
      const totalDays = Math.max(1, (new Date(l.target_payoff_date) - new Date(startStr)) / 86400000);
      const elapsedDays = Math.max(0, (today - new Date(startStr)) / 86400000);
      const expected_paid_pct = Math.min(1, elapsedDays / totalDays);
      const actual_paid_pct = Number(l.current_balance) > 0 ? Math.min(1, paid / Number(l.current_balance)) : 1;
      const overdue = todayStr > l.target_payoff_date && estimated_remaining > 0;

      let pace_status;
      if (overdue) pace_status = "red";
      else if (actual_paid_pct >= expected_paid_pct) pace_status = "green";
      else if (actual_paid_pct >= expected_paid_pct * 0.7) pace_status = "yellow";
      else pace_status = "red";

      const lastPaymentDate = linkedExpenses.reduce((latest, e) => (!latest || e.expense_date > latest ? e.expense_date : latest), null);
      const days_since_payment = Math.floor((today - new Date(lastPaymentDate || startStr)) / 86400000);
      const needs_payment_reminder = estimated_remaining > 0 && days_since_payment >= 45;

      Object.assign(result, { pace_status, expected_paid_pct, actual_paid_pct, overdue, days_since_payment, needs_payment_reminder });
    }

    return result;
  });
}

/** Each active recurring bill, with whether it's already been logged (paid) this month. */
function btBillsStatus(store, today = new Date()) {
  const { month } = btPeriodBounds(today);
  return store.bills
    .filter((b) => b.active !== false)
    .map((b) => {
      const paidEntry = store.expenses.find((e) => e.bill_id === b.id && btDateInRange(e.expense_date, month.start, month.end));
      return { ...b, paidThisMonth: !!paidEntry, paidAmount: paidEntry ? Number(paidEntry.amount) : null };
    })
    .sort((a, b) => a.day_of_month - b.day_of_month);
}

/** Cost of living = essential-category spending in range, converted into viewCurrency. */
function btCostOfLiving(store, start, end, viewCurrency, profile) {
  const essentials = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.ESSENTIAL_CATEGORIES) || [];
  return essentials.reduce((s, cat) => s + btSumExpenseCategoryInRange(store.expenses, cat, start, end, viewCurrency, profile), 0);
}

/** What's left after essentials AND what's already been put toward savings/investing — the money actually free to allocate further. */
function btDisposableIncome(store, summary) {
  const costOfLiving = btCostOfLiving(store, summary.periods.month.start, summary.periods.month.end, summary.viewCurrency, store.profile);
  const savedThisMonth = btSumExpenseCategoryInRange(store.expenses, "Savings & Investments", summary.periods.month.start, summary.periods.month.end, summary.viewCurrency, store.profile);
  const disposable = summary.periods.month.income - costOfLiving - savedThisMonth;
  return { costOfLiving, savedThisMonth, disposable };
}

/** Debts still owed, in avalanche order — highest interest rate first, debts with no rate entered last (unknown, not free). Shared by the Dashboard's Debt Tracker list and the debt-payoff nudge below. */
function btDebtAvalancheOrder(store) {
  return btLiabilityProgress(store).sort((a, b) => {
    if (a.interest_rate == null && b.interest_rate == null) return 0;
    if (a.interest_rate == null) return 1;
    if (b.interest_rate == null) return -1;
    return b.interest_rate - a.interest_rate;
  });
}

/** Whether there's meaningful disposable income this month worth nudging toward debt, and which debt (the avalanche-priority one) to suggest it go to. */
function btDebtPayoffOpportunity(store, summary) {
  const { disposable } = btDisposableIncome(store, summary);
  const owed = btDebtAvalancheOrder(store).filter((l) => l.estimated_remaining > 0);
  if (!owed.length || !(disposable > 0)) return { eligible: false, disposable, topDebt: null };
  return { eligible: true, disposable, topDebt: owed[0] };
}

/** Red/Yellow/Green health flags, thresholds straight from the source spreadsheet's guideline sheets. */
function btHealthFlags(store, summary, today = new Date()) {
  const T = BT_CONFIG.THRESHOLDS;
  const flags = [];
  const monthNet = summary.periods.month.net;
  const monthIncome = summary.periods.month.income;
  const vc = summary.viewCurrency;

  if (summary.hasUnconverted) {
    flags.push({ level: "yellow", text: "Some entries are in a currency without an exchange rate set — these numbers may be incomplete. Add rates in Settings." });
  }

  if (monthIncome > 0) {
    const netPct = monthNet / monthIncome;
    if (monthNet < 0) flags.push({ level: "red", text: "You're spending more than you're earning this month — book a consultation." });
    else if (netPct < T.cashFlowYellowPct) flags.push({ level: "yellow", text: "What's left over this month is thin (under 5% of income)." });
    else if (netPct >= T.cashFlowGreenPct) flags.push({ level: "green", text: "Healthy surplus this month — on track." });

    const debtPaid = btSumExpenseCategoryInRange(store.expenses, "Debt Repayment", summary.periods.month.start, summary.periods.month.end, vc, store.profile);
    const debtRatio = debtPaid / monthIncome;
    if (debtRatio > T.debtRatioRed) flags.push({ level: "red", text: "Debt payments are over 40% of income this month." });
    else if (debtRatio > T.debtRatioYellow) flags.push({ level: "yellow", text: "Debt payments are 20–40% of income this month." });

    const housingPaid = btSumExpenseCategoryInRange(store.expenses, "Housing", summary.periods.month.start, summary.periods.month.end, vc, store.profile);
    if (housingPaid / monthIncome > T.housingRatioRed) flags.push({ level: "red", text: "Housing costs are over 30% of income this month." });
  }

  if (summary.annualIncomeEstimate > 0) {
    const rate = summary.ytdSavingsActual / summary.annualIncomeEstimate;
    if (rate >= T.savingsRateGreen) flags.push({ level: "green", text: "Savings rate is 20%+ of income — on track for financial independence." });
    else if (rate >= T.savingsRateYellow) flags.push({ level: "yellow", text: "Savings rate is 10–20% of income." });
    else flags.push({ level: "red", text: "Savings rate is under 10% of income — book a consultation." });
  }

  const budgets = store.profile?.category_budgets || {};
  Object.entries(budgets).forEach(([cat, limit]) => {
    if (!limit || limit <= 0) return;
    const spent = btSumExpenseCategoryInRange(store.expenses, cat, summary.periods.month.start, summary.periods.month.end, vc, store.profile);
    const pct = spent / limit;
    if (pct > 1) flags.push({ level: "red", text: `${cat} is over budget this month (${Math.round(pct * 100)}% of what you set).` });
    else if (pct > 0.85) flags.push({ level: "yellow", text: `${cat} is close to its monthly budget (${Math.round(pct * 100)}% used).` });
  });

  if (monthIncome > 0) {
    const { disposable } = btDisposableIncome(store, summary);
    if (disposable > 0 && disposable / monthIncome >= 0.10) {
      flags.push({ level: "green", text: `You have disposable income this month beyond essentials and savings — a chance to invest more or top up a goal.` });
    }
  }

  const debtsWithTargets = btLiabilityProgress(store, today).filter((l) => l.target_payoff_date && l.estimated_remaining > 0);
  const worstBehind = debtsWithTargets.filter((l) => l.pace_status === "red").sort((a, b) => a.expected_paid_pct - a.actual_paid_pct < b.expected_paid_pct - b.actual_paid_pct ? 1 : -1)[0];
  if (worstBehind) {
    flags.push({ level: "red", text: worstBehind.overdue
      ? `${worstBehind.debt_name} is past its target payoff date — a top-up now keeps it from dragging on.`
      : `${worstBehind.debt_name} is behind pace to be paid off by ${worstBehind.target_payoff_date} — consider a top-up payment.` });
  }
  const needsReminder = debtsWithTargets.find((l) => l.needs_payment_reminder);
  if (needsReminder) {
    flags.push({ level: "yellow", text: `No payment logged toward ${needsReminder.debt_name} in ${needsReminder.days_since_payment} days — a quick payment keeps it on track for ${needsReminder.target_payoff_date}.` });
  }

  return flags;
}

/**
 * Whether now looks like a good moment to prompt "talk to your advisor
 * about investing more": a healthy, balanced budget (no red flags this
 * month) plus meaningful disposable income beyond essentials and
 * savings. Re-evaluated on every render, so the prompt naturally shows
 * up again any time it becomes true — no separate notification system
 * needed.
 */
function btInvestmentOpportunity(store, summary, flags) {
  const healthFlags = flags || btHealthFlags(store, summary);
  const hasRedFlag = healthFlags.some((f) => f.level === "red");
  const monthIncome = summary.periods.month.income;
  const { disposable } = btDisposableIncome(store, summary);
  const disposablePct = monthIncome > 0 ? disposable / monthIncome : 0;
  return {
    eligible: !hasRedFlag && monthIncome > 0 && disposablePct >= 0.10,
    disposable, disposablePct
  };
}

/* ── Protection & Retirement Planner — standard coverage multiples
   applied to a client's own income (BT_CONFIG.PROTECTION). These are
   guideline figures to open a conversation with an advisor, never a
   substitute for one. ── */

/** Emergency fund target: months of income (client-set, floor enforced) × the shared annual income basis, monthly. */
function btEmergencyFundTarget(store, viewCurrency, months, today = new Date()) {
  const min = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.PROTECTION?.emergencyFundMinMonths) || 6;
  const basis = btAnnualIncomeBasis(store, viewCurrency, today);
  const monthlyIncome = basis.annualIncome / 12;
  const m = Math.max(min, Math.round(Number(months) || min));
  return { monthlyIncome, months: m, target: monthlyIncome * m, isFixedIncome: basis.isFixed };
}

/** Critical illness fund — a step up from the emergency fund: BT_CONFIG.PROTECTION.criticalIllnessAnnualMultiple × the shared annual income basis. */
function btCriticalIllnessFundTarget(store, viewCurrency, today = new Date()) {
  const multiple = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.PROTECTION?.criticalIllnessAnnualMultiple) || 5;
  const basis = btAnnualIncomeBasis(store, viewCurrency, today);
  return { annualIncome: basis.annualIncome, multiple, target: basis.annualIncome * multiple, isFixedIncome: basis.isFixed };
}

/** Life insurance coverage guideline — BT_CONFIG.PROTECTION.lifeInsuranceAnnualMultiple × the shared annual income basis. */
function btLifeInsuranceTarget(store, viewCurrency, today = new Date()) {
  const multiple = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.PROTECTION?.lifeInsuranceAnnualMultiple) || 10;
  const basis = btAnnualIncomeBasis(store, viewCurrency, today);
  return { annualIncome: basis.annualIncome, multiple, target: basis.annualIncome * multiple, isFixedIncome: basis.isFixed };
}

/** Retirement monthly payout target — BT_CONFIG.PROTECTION.retirementSalaryReplacementPct of the shared annual income basis, monthly. Null only when there's no fixed income set AND nothing logged to estimate from. */
function btRetirementMonthlyTarget(store, viewCurrency, profile) {
  const basis = btAnnualIncomeBasis(store, viewCurrency);
  if (!(basis.annualIncome > 0)) return null;
  const pct = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.PROTECTION?.retirementSalaryReplacementPct) || 0.75;
  const monthlySalary = basis.annualIncome / 12;
  return { monthlySalary, pct, target: monthlySalary * pct, isFixedIncome: basis.isFixed };
}

/** Age in whole years from a "YYYY-MM-DD" date of birth, or null if unset. */
function btAge(dateOfBirth, today = new Date()) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob)) return null;
  let age = today.getFullYear() - dob.getFullYear();
  const beforeBirthdayThisYear = (today.getMonth() < dob.getMonth()) || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
  if (beforeBirthdayThisYear) age--;
  return age;
}

/** Whether the Burial Fund section applies to this client — from BURIAL_FUND_MIN_AGE onward, once their date of birth is known. */
function btBurialFundApplies(profile) {
  const age = btAge(profile?.date_of_birth);
  const minAge = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.BURIAL_FUND_MIN_AGE) || 50;
  return age != null && age >= minAge;
}

/** Typical low/high cost range across every Burial Fund line item — the ballpark shown before any per-item adjustment. */
function btBurialFundRange() {
  const items = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.BURIAL_FUND_ITEMS) || [];
  return items.reduce((acc, it) => ({ low: acc.low + it.low, high: acc.high + it.high }), { low: 0, high: 0 });
}

/** Per-item Burial Fund estimate: the client's own saved figure if they've adjusted it, else the midpoint of that item's typical range. */
function btBurialFundItemValues(profile) {
  const items = (typeof BT_CONFIG !== "undefined" && BT_CONFIG.BURIAL_FUND_ITEMS) || [];
  const overrides = profile?.burial_fund_estimates || {};
  return items.map((it) => ({ ...it, value: overrides[it.key] ?? Math.round((it.low + it.high) / 2) }));
}

/** Burial Fund total — sum of the current per-item estimates (saved overrides or defaults). */
function btBurialFundTotal(profile) {
  return btBurialFundItemValues(profile).reduce((s, it) => s + Number(it.value || 0), 0);
}

/**
 * Whether every base is covered: Emergency Fund, Critical Illness Fund,
 * and — for clients 50 and over — Burial Fund each have a linked goal
 * saved at or beyond its target. This is the gate for unlocking the
 * Vacation Vault — Life Insurance and Retirement aren't included here
 * since neither has a trackable "amount saved so far" the way a goal
 * does. Burial Fund is skipped entirely for clients under the minimum
 * age (or with no date of birth on file yet), since the section isn't
 * available to them to fund in the first place.
 */
function btProtectionFullyCovered(store, viewCurrency, profile) {
  const goals = btGoalProgress(store);
  const isCovered = (category, target) => {
    const linked = goals.filter((g) => g.category === category);
    if (!linked.length || !(target > 0)) return false;
    const saved = linked.reduce((s, g) => s + g.saved_amount, 0);
    return saved >= target;
  };
  const ef = btEmergencyFundTarget(store, viewCurrency, profile?.emergency_fund_months);
  const ci = btCriticalIllnessFundTarget(store, viewCurrency);
  const bfApplies = btBurialFundApplies(profile);
  const bfTarget = btBurialFundTotal(profile);
  return isCovered("Emergency Fund", ef.target) && isCovered("Critical Illness Fund", ci.target) && (!bfApplies || isCovered("Burial Fund", bfTarget));
}

/**
 * Combined progress toward unlocking the Vacation Vault — Emergency Fund,
 * Critical Illness Fund, and (for clients 50+) Burial Fund, saved vs
 * target, added together. Each fund's contribution is capped at its own
 * target so overfunding one can't mask another sitting empty; pct only
 * reaches 100% exactly when btProtectionFullyCovered would also be true.
 */
function btVacationVaultUnlockProgress(store, viewCurrency, profile) {
  const goals = btGoalProgress(store);
  const savedIn = (category) => goals.filter((g) => g.category === category).reduce((s, g) => s + g.saved_amount, 0);
  const ef = btEmergencyFundTarget(store, viewCurrency, profile?.emergency_fund_months);
  const ci = btCriticalIllnessFundTarget(store, viewCurrency);
  const parts = [
    { category: "Emergency Fund", saved: savedIn("Emergency Fund"), target: ef.target },
    { category: "Critical Illness Fund", saved: savedIn("Critical Illness Fund"), target: ci.target }
  ];
  if (btBurialFundApplies(profile)) {
    parts.push({ category: "Burial Fund", saved: savedIn("Burial Fund"), target: btBurialFundTotal(profile) });
  }
  const totalSaved = parts.reduce((s, p) => s + Math.min(p.saved, p.target), 0);
  const totalTarget = parts.reduce((s, p) => s + p.target, 0);
  return {
    pct: totalTarget > 0 ? Math.min(1, totalSaved / totalTarget) : 0,
    totalSaved, totalTarget, parts,
    unlocked: btProtectionFullyCovered(store, viewCurrency, profile)
  };
}

/** Suggested monthly Vacation Vault contribution — a client-chosen percentage (0-100) of this month's disposable income. */
function btVacationVaultSuggestion(disposable, pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return { pct: p, monthlyContribution: Math.max(0, disposable) * (p / 100) };
}
