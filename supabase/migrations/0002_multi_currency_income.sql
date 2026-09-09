-- ============================================================
-- Multi-currency income + manual exchange rates.
--
-- Clients can log income in more than one currency (e.g. a TTD salary
-- plus USD freelance work). Each income entry now carries its own
-- currency; bt_profiles.fx_rates holds the manual conversion rates
-- (foreign currency -> home currency) a client sets themselves in
-- Settings, so converting between currencies on the Dashboard never
-- needs a live exchange-rate API — it keeps working fully offline,
-- same as the rest of this app.
-- ============================================================

alter table public.bt_income_entries
  add column currency text not null default 'TTD';

alter table public.bt_profiles
  add column fx_rates jsonb not null default '{}'::jsonb;

comment on column public.bt_income_entries.currency is
  'ISO-ish currency code for this entry (e.g. TTD, USD). Defaults to the client''s home currency at entry time.';
comment on column public.bt_profiles.fx_rates is
  'Manual exchange rates the client sets themselves: { "USD": 6.8 } means 1 USD = 6.8 units of home currency. Set in Settings -> Exchange Rates.';

-- 0001's column-level grant on bt_profiles only listed the original
-- Settings fields — extend it to include fx_rates, or clients can never
-- save their own exchange rates through the normal Settings form.
revoke update on public.bt_profiles from authenticated;
grant update (full_name, currency, annual_savings_target_pct, model_year, fx_rates) on public.bt_profiles to authenticated;
