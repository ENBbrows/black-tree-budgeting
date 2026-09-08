/* ═════════════════════════════════════════════════════════
   BLACK TREE — shared auth helpers (magic-link login via Supabase).

   Loaded after config.js and the supabase-js CDN script on every page.
   Session tokens are kept by supabase-js in localStorage, which is what
   lets a page load and read the logged-in user with zero network — the
   piece that makes the app usable offline once you've logged in once.
   ═════════════════════════════════════════════════════════ */

const btSupabase = window.supabase.createClient(BT_CONFIG.SUPABASE_URL, BT_CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

/** Send a magic sign-in link to an email. Requires network. */
async function btSendMagicLink(email) {
  const { error } = await btSupabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "dashboard.html" }
  });
  if (error) throw error;
}

async function btSignOut() {
  try { await btSupabase.auth.signOut(); } catch (e) { /* offline sign-out still clears local session below */ }
  const session = await btSupabase.auth.getSession();
  const uid = session?.data?.session?.user?.id;
  if (uid) { localStorage.removeItem(btStoreKey(uid)); localStorage.removeItem(btQueueKey(uid)); }
}

/** Returns the current session's user immediately from local storage — no network round trip. */
async function btGetSession() {
  const { data } = await btSupabase.auth.getSession();
  return data.session;
}

/**
 * Call at the top of every protected page. If there's no session at all
 * (never logged in on this device), sends the visitor to the login
 * screen. If there IS a session — even a stale one, even fully offline —
 * lets the page render from local cache; btSync() will refresh it
 * quietly in the background once a connection is available.
 */
async function btRequireAuth() {
  const session = await btGetSession();
  if (!session) {
    const here = window.location.pathname.split("/").pop();
    window.location.replace("login.html?redirect=" + encodeURIComponent(here));
    return null;
  }
  return session.user;
}

/** Fetch (or lazily create/read) this user's bt_profiles row. Network required the first time only. */
async function btGetOrLoadProfile(userId) {
  const cached = btLoadStore(userId).profile;
  if (navigator.onLine) {
    try {
      const { data, error } = await btSupabase.from("bt_profiles").select("*").eq("id", userId).single();
      if (!error && data) {
        const store = btLoadStore(userId);
        store.profile = data;
        btSaveStore(userId, store);
        return data;
      }
    } catch (e) { /* fall through to cache */ }
  }
  return cached;
}
