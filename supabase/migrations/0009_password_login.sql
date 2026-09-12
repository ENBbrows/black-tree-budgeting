-- ============================================================
-- Password sign-in for every account (not just the admin console).
-- Magic links are single-use and expire quickly, which is secure but
-- meant every sign-in required waiting on a fresh email. Any account
-- can now call btSetPassword() once (after arriving via a normal magic
-- link) to set a password and sign in directly, as many times as they
-- like, from then on. has_password just lets the UI know when to stop
-- prompting someone to set one up — it carries no security weight of
-- its own, since Supabase Auth is still what enforces the password.
-- ============================================================

alter table public.bt_profiles
  add column has_password boolean not null default false;

grant update (has_password) on public.bt_profiles to authenticated;
