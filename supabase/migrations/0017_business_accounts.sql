-- ============================================================
-- Small Business accounts: a second account type alongside the
-- existing personal budgeting one, sharing the same login/sync
-- infrastructure but with its own categories, VAT tracking, and
-- per-contract job costing (built with a contracting business in
-- mind, general enough for other small businesses too).
-- ============================================================

-- Bug fix found while adding this: the category check constraints below
-- have needed a matching migration every time config.js's category list
-- grew (0004 added "Taxes" this way), and "Charity / Tithe / Zakat" was
-- added to config.js without one — any expense in that category has
-- been silently rejected by the database ever since. Rather than keep
-- maintaining a duplicate enum in two places (and adding a full set of
-- business categories to it now), drop these constraints entirely and
-- let the app's own category chips be the single source of truth —
-- exactly how bt_goals.category already works, with no DB constraint.
alter table public.bt_expense_entries drop constraint if exists bt_expense_entries_category_check;
alter table public.bt_recurring_bills drop constraint if exists bt_recurring_bills_category_check;

alter table public.bt_profiles add column if not exists account_type text not null default 'personal' check (account_type in ('personal', 'business'));
alter table public.bt_profiles add column if not exists business_name text;
alter table public.bt_profiles add column if not exists vat_registered boolean not null default false;
alter table public.bt_profiles add column if not exists vat_number text;
-- Trinidad & Tobago's standard VAT rate at time of writing — editable in
-- Settings since tax law changes; this app tracks bookkeeping figures,
-- it is not a substitute for a licensed accountant confirming the actual
-- filing treatment.
alter table public.bt_profiles add column if not exists vat_rate numeric not null default 12.5;

grant update (account_type, business_name, vat_registered, vat_number, vat_rate) on public.bt_profiles to authenticated;

-- VAT on individual transactions: output VAT collected on a sale (income)
-- or input VAT paid on an eligible purchase (expense). vat_treatment
-- covers the four standard T&T categories; vat_amount is the client's
-- own entered figure, not recalculated from vat_rate, since a line item
-- can have a different treatment than the account's overall registration.
alter table public.bt_income_entries add column if not exists vat_amount numeric;
alter table public.bt_income_entries add column if not exists vat_treatment text check (vat_treatment in ('standard_rated', 'zero_rated', 'exempt', 'out_of_scope'));
alter table public.bt_expense_entries add column if not exists vat_amount numeric;
alter table public.bt_expense_entries add column if not exists vat_treatment text check (vat_treatment in ('standard_rated', 'zero_rated', 'exempt', 'out_of_scope'));

-- Income entries never had a category — "source" is free text. A business
-- account groups income by BUSINESS_INCOME_CATEGORIES (Contract Revenue,
-- etc.) for its P&L, same no-DB-constraint approach as everything else
-- here; a personal account just leaves this null.
alter table public.bt_income_entries add column if not exists category text;

-- ---------------------------------------------------------------
-- Projects — a contract/job a business account can tag income and
-- expenses to, for simple per-project profitability (not full job
-- costing: no budgets, no change orders, just a P&L filter).
-- ---------------------------------------------------------------
create table if not exists public.bt_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz not null default now()
);

alter table public.bt_income_entries add column if not exists project_id uuid references public.bt_projects(id) on delete set null;
alter table public.bt_expense_entries add column if not exists project_id uuid references public.bt_projects(id) on delete set null;

create index if not exists bt_projects_user_idx on public.bt_projects (user_id);
create index if not exists bt_income_entries_project_idx on public.bt_income_entries (project_id) where project_id is not null;
create index if not exists bt_expense_entries_project_idx on public.bt_expense_entries (project_id) where project_id is not null;

alter table public.bt_projects enable row level security;

create policy "bt_projects_select" on public.bt_projects
  for select to authenticated using (user_id = auth.uid() or bt_is_my_client(user_id));
create policy "bt_projects_write" on public.bt_projects
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
