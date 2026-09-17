-- Itemized Vacation Vault trip-cost breakdown (airfare, hotel, food,
-- entertainment, travel, gifts/souvenirs) — same pattern as
-- burial_fund_estimates.
alter table public.bt_profiles add column if not exists vacation_vault_estimates jsonb not null default '{}'::jsonb;

grant update (vacation_vault_estimates) on public.bt_profiles to authenticated;
