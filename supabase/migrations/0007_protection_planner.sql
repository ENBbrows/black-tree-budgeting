-- ============================================================
-- Protection & Retirement Planner — a client-set "months of income"
-- input for the Emergency Fund calculator, and per-item overrides for
-- the Burial Fund breakdown. Everything else on that page (Critical
-- Illness Fund, Life Insurance, Retirement target) is computed live
-- from existing income data, no new storage needed.
--
-- The floor of 6 months is enforced here too, not just in the UI —
-- a direct PATCH can't set it below 6 any more than the app's own
-- form can.
-- ============================================================

alter table public.bt_profiles
  add column emergency_fund_months int not null default 6 check (emergency_fund_months >= 6);

alter table public.bt_profiles
  add column burial_fund_estimates jsonb not null default '{}'::jsonb;

grant update (emergency_fund_months, burial_fund_estimates) on public.bt_profiles to authenticated;
