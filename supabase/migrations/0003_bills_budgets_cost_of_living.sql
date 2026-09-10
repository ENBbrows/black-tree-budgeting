-- ============================================================
-- Recurring bills, category budgets, and cost-of-living context.
--
-- Recurring bills: a client sets up "Rent — Housing — 2000/month" once
-- and gets a one-tap "Mark as paid" on the Dashboard each month instead
-- of re-typing the same expense every time.
--
-- Category budgets: an optional monthly ceiling per expense category,
-- so "Spending by Category" can show over/under at a glance and the
-- health checks can flag a specific category running hot — not just
-- overall cash flow.
--
-- dependents_count: a simple headcount (not individual profiles) used
-- only to give the cost-of-living / disposable-income figures context.
-- ============================================================

create table public.bt_recurring_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in (
    'Housing', 'Utilities', 'Transport', 'Food', 'Personal',
    'Insurance', 'Debt Repayment', 'Savings & Investments', 'Education', 'Other'
  )),
  amount numeric not null check (amount > 0),
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.bt_expense_entries
  add column bill_id uuid references public.bt_recurring_bills(id) on delete set null;

create index bt_recurring_bills_user_idx on public.bt_recurring_bills (user_id);
create index bt_expense_entries_bill_idx on public.bt_expense_entries (bill_id) where bill_id is not null;

alter table public.bt_profiles add column category_budgets jsonb not null default '{}'::jsonb;
alter table public.bt_profiles add column dependents_count int not null default 0 check (dependents_count >= 0);

comment on column public.bt_profiles.category_budgets is
  'Optional monthly ceiling per expense category the client sets themselves: { "Food": 1500 }. Missing/zero means no budget set for that category.';
comment on column public.bt_profiles.dependents_count is
  'How many people the client''s income supports, for cost-of-living context. A headcount, not individual dependent records.';

revoke update on public.bt_profiles from authenticated;
grant update (full_name, currency, annual_savings_target_pct, model_year, fx_rates, category_budgets, dependents_count) on public.bt_profiles to authenticated;

alter table public.bt_recurring_bills enable row level security;

create policy "bt_bills_select" on public.bt_recurring_bills
  for select to authenticated using (user_id = auth.uid() or bt_is_my_client(user_id));
create policy "bt_bills_write" on public.bt_recurring_bills
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
