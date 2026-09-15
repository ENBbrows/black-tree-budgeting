-- ============================================================
-- Activity tracking — lets the admin see how many accounts exist
-- and who's actively using the platform right now, without exposing
-- any financial data. Every authenticated page touches this on load
-- via btTouchActivity() (fire-and-forget, never blocks). Admin's
-- existing SELECT-all policy on bt_profiles (0006) already covers
-- reading this column, so no RLS change is needed here.
-- ============================================================

alter table public.bt_profiles
  add column last_active_at timestamptz;

grant update (last_active_at) on public.bt_profiles to authenticated;
