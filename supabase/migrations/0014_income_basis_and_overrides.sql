-- A single fixed annual income figure the client sets once in Settings.
-- When set, Emergency Fund, Critical Illness Fund, Life Insurance, and
-- Retirement Target all calculate off this one number instead of an
-- estimate that drifts as income entries accumulate through the year.
-- Left unset, those calculations keep falling back to the existing
-- year-to-date estimate, so nothing changes for a client who never sets it.
alter table public.bt_profiles add column if not exists annual_income numeric;

-- Manual monthly-pace overrides for Critical Illness Fund and Life
-- Insurance — when set, replaces the automatic "target ÷ 12" guideline
-- pace shown for that fund. Doesn't change the fund's target amount,
-- only the suggested monthly contribution toward it.
alter table public.bt_profiles add column if not exists critical_illness_monthly_override numeric;
alter table public.bt_profiles add column if not exists life_insurance_monthly_override numeric;

grant update (
  annual_income,
  critical_illness_monthly_override,
  life_insurance_monthly_override
) on public.bt_profiles to authenticated;
