-- Hajj/Umrah Fund — itemized pilgrimage-trip breakdown, a sub-fund
-- alongside the Vacation Vault. Same pattern as vacation_vault_estimates.
alter table public.bt_profiles add column if not exists hajj_umrah_estimates jsonb not null default '{}'::jsonb;

grant update (hajj_umrah_estimates) on public.bt_profiles to authenticated;
