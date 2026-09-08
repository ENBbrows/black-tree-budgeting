/* Black Tree — app-shell service worker.
   Scoped to /blacktree/ (registered from within this folder), so it
   never touches the rest of the Eleganza site. Precaches every page +
   asset so the app opens with zero network once installed; runtime
   requests fall back to network-first so a live connection always
   wins when available, cache when it isn't. */

const BT_CACHE = "blacktree-shell-v1";

const BT_PRECACHE = [
  "login.html",
  "income.html",
  "expense.html",
  "dashboard.html",
  "agent.html",
  "setup-guide.html",
  "offline.html",
  "config.js",
  "auth.js",
  "store.js",
  "theme.css",
  "manifest-income.webmanifest",
  "manifest-expense.webmanifest",
  "manifest-dashboard.webmanifest",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-180.png",
  "assets/wordmark-gold.png",
  "assets/wordmark-ivory.png",
  "assets/emblem-gold.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(BT_CACHE).then((cache) => cache.addAll(BT_PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== BT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // writes always go straight to Supabase, queued client-side if offline

  // Never intercept Supabase API/auth calls — those need real network-or-fail behavior.
  if (req.url.includes(".supabase.co")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(BT_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === "navigate" ? caches.match("offline.html") : undefined))
      )
  );
});
