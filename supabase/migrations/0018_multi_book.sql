-- ============================================================
-- Multi-book support: one login, several separate books switchable
-- from the Dashboard (Personal, plus as many Business books as the
-- client adds) — each with its own income, expenses, goals, debts,
-- bills, documents, projects, and settings (account type, business
-- name, VAT, currency, category budgets, insurance, protection
-- planner figures). Previously all of that lived once per user on
-- bt_profiles; a user can now own several bt_books rows instead, and
-- every per-user data table gets a book_id saying which book a row
-- belongs to.
--
-- bt_profiles keeps only genuinely cross-book things: full_name,
-- has_password, role, agent_id, fx_rates (a real-world exchange rate
-- isn't "personal" or "business", it's just market data), and the
-- legacy columns from migrations 0001-0017 that moved into bt_books
-- below. Those old columns are deliberately left in place rather than
-- dropped — this is a live app with real client data, and there's no
-- upside to a destructive DROP COLUMN here; the application code
-- simply stops reading/writing them going forward.
-- ============================================================

create table public.bt_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  sort_order int not null default 0,

  account_type text not null default 'personal' check (account_type in ('personal', 'business')),
  business_name text,
  vat_registered boolean not null default false,
  vat_number text,
  vat_rate numeric not null default 12.5,

  currency text not null default 'TTD',
  annual_income numeric,
  dependents_count int not null default 0 check (dependents_count >= 0),
  date_of_birth date,
  category_budgets jsonb not null default '{}'::jsonb,

  emergency_fund_months int not null default 6 check (emergency_fund_months >= 6),
  critical_illness_monthly_override numeric,
  life_insurance_monthly_override numeric,
  burial_fund_estimates jsonb not null default '{}'::jsonb,
  vacation_vault_pct numeric not null default 10 check (vacation_vault_pct >= 0 and vacation_vault_pct <= 100),
  vacation_vault_estimates jsonb not null default '{}'::jsonb,
  hajj_umrah_estimates jsonb not null default '{}'::jsonb,
  car_insurance_premium numeric,
  car_insurance_renewal_date date,
  property_insurance_premium numeric,
  property_insurance_renewal_date date,

  created_at timestamptz not null default now()
);

create index bt_books_user_idx on public.bt_books (user_id);

-- Exactly one book per user can be the default (the one a brand-new
-- session falls back to if its last-selected book was deleted).
create unique index bt_books_one_default_per_user on public.bt_books (user_id) where is_default;

-- One starter "Personal" book per existing user, carrying over their
-- current settings so switching to multi-book changes nothing about
-- what they see today.
insert into public.bt_books (
  user_id, name, is_default, account_type, business_name, vat_registered, vat_number, vat_rate,
  currency, annual_income, dependents_count, date_of_birth, category_budgets,
  emergency_fund_months, critical_illness_monthly_override, life_insurance_monthly_override,
  burial_fund_estimates, vacation_vault_pct, vacation_vault_estimates, hajj_umrah_estimates,
  car_insurance_premium, car_insurance_renewal_date, property_insurance_premium, property_insurance_renewal_date
)
select
  p.id, case when p.account_type = 'business' then coalesce(p.business_name, 'My Business') else 'Personal' end, true,
  p.account_type, p.business_name, p.vat_registered, p.vat_number, p.vat_rate,
  p.currency, p.annual_income, p.dependents_count, p.date_of_birth, p.category_budgets,
  p.emergency_fund_months, p.critical_illness_monthly_override, p.life_insurance_monthly_override,
  p.burial_fund_estimates, p.vacation_vault_pct, p.vacation_vault_estimates, p.hajj_umrah_estimates,
  p.car_insurance_premium, p.car_insurance_renewal_date, p.property_insurance_premium, p.property_insurance_renewal_date
from public.bt_profiles p;

-- book_id on every per-user data table — nullable at first so the
-- backfill below can run, then locked to not-null once every existing
-- row has one.
alter table public.bt_income_entries add column book_id uuid references public.bt_books(id) on delete cascade;
alter table public.bt_expense_entries add column book_id uuid references public.bt_books(id) on delete cascade;
alter table public.bt_goals add column book_id uuid references public.bt_books(id) on delete cascade;
alter table public.bt_liabilities add column book_id uuid references public.bt_books(id) on delete cascade;
alter table public.bt_recurring_bills add column book_id uuid references public.bt_books(id) on delete cascade;
alter table public.bt_documents add column book_id uuid references public.bt_books(id) on delete cascade;
alter table public.bt_projects add column book_id uuid references public.bt_books(id) on delete cascade;

update public.bt_income_entries e set book_id = b.id from public.bt_books b where b.user_id = e.user_id and b.is_default;
update public.bt_expense_entries e set book_id = b.id from public.bt_books b where b.user_id = e.user_id and b.is_default;
update public.bt_goals g set book_id = b.id from public.bt_books b where b.user_id = g.user_id and b.is_default;
update public.bt_liabilities l set book_id = b.id from public.bt_books b where b.user_id = l.user_id and b.is_default;
update public.bt_recurring_bills r set book_id = b.id from public.bt_books b where b.user_id = r.user_id and b.is_default;
update public.bt_documents d set book_id = b.id from public.bt_books b where b.user_id = d.user_id and b.is_default;
update public.bt_projects pr set book_id = b.id from public.bt_books b where b.user_id = pr.user_id and b.is_default;

alter table public.bt_income_entries alter column book_id set not null;
alter table public.bt_expense_entries alter column book_id set not null;
alter table public.bt_goals alter column book_id set not null;
alter table public.bt_liabilities alter column book_id set not null;
alter table public.bt_recurring_bills alter column book_id set not null;
alter table public.bt_documents alter column book_id set not null;
alter table public.bt_projects alter column book_id set not null;

create index bt_income_entries_book_idx on public.bt_income_entries (book_id);
create index bt_expense_entries_book_idx on public.bt_expense_entries (book_id);
create index bt_goals_book_idx on public.bt_goals (book_id);
create index bt_liabilities_book_idx on public.bt_liabilities (book_id);
create index bt_recurring_bills_book_idx on public.bt_recurring_bills (book_id);
create index bt_documents_book_idx on public.bt_documents (book_id);
create index bt_projects_book_idx on public.bt_projects (book_id);

-- Same ownership model as every other table here: the owning client
-- can do anything with their own books, their assigned agent (if any)
-- gets read-only visibility, same as bt_projects/bt_goals/etc.
alter table public.bt_books enable row level security;

create policy "bt_books_select" on public.bt_books
  for select to authenticated using (user_id = auth.uid() or bt_is_my_client(user_id));
create policy "bt_books_write" on public.bt_books
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
