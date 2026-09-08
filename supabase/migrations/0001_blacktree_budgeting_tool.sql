-- ============================================================
-- Black Tree Investments — Budgeting & Goal Tracking Tool
--
-- A separate, self-contained set of tables for the Black Tree budgeting
-- app (blacktree/). Unrelated to the Eleganza booking tables above —
-- prefixed bt_ so it can live in the same Supabase project without
-- colliding, or be pointed at its own project via blacktree/config.js.
--
-- Two roles share this schema:
--   client — logs their own income/expenses, sees only their own data.
--   agent  — a Black Tree advisor. Can be assigned clients and gets
--            READ-ONLY visibility into those clients' numbers (to prep
--            for / run a consultation). Agents never see another
--            agent's book, and can never edit a client's data for them.
--
-- Every table carries user_id = the client the data belongs to, and RLS
-- is the only thing standing between one person's finances and the next
-- person's screen — get this right before anything else.
-- ============================================================

-- ---------------------------------------------------------------
-- Profiles — one row per authenticated user (client or agent).
-- ---------------------------------------------------------------
create table public.bt_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'client' check (role in ('client', 'agent')),
  agent_id uuid references public.bt_profiles(id) on delete set null,
  currency text not null default 'TTD',
  model_year int not null default extract(year from now())::int,
  annual_savings_target_pct numeric not null default 0.20 check (annual_savings_target_pct >= 0 and annual_savings_target_pct <= 1),
  created_at timestamptz not null default now()
);

-- A client cannot be their own agent, and an agent can't be assigned an agent.
alter table public.bt_profiles
  add constraint bt_profiles_agent_not_self check (agent_id is distinct from id);

-- New Supabase Auth user -> auto-create their profile row.
create or replace function public.bt_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bt_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger bt_on_auth_user_created
  after insert on auth.users
  for each row execute function public.bt_handle_new_user();

-- ---------------------------------------------------------------
-- Goals — savings/debt-adjacent targets a client sets for themself.
-- ---------------------------------------------------------------
create table public.bt_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  category text not null default 'Other',
  target_amount numeric not null check (target_amount > 0),
  opening_amount numeric not null default 0 check (opening_amount >= 0),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Liabilities — debts a client is tracking payoff progress against.
-- ---------------------------------------------------------------
create table public.bt_liabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  debt_name text not null,
  lender text,
  interest_rate numeric,
  current_balance numeric not null check (current_balance >= 0),
  min_payment numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Income entries — Shortcut 1 (mobile quick-entry).
-- ---------------------------------------------------------------
create table public.bt_income_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  amount numeric not null check (amount > 0),
  frequency text not null check (frequency in ('Weekly', 'Bi-Weekly', 'Monthly', 'Annually', 'One-time')),
  entry_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Expense entries — Shortcut 2 (mobile quick-entry). Category covers
-- every outflow type (including debt payments, savings contributions
-- and insurance premiums) so one quick form can feed the whole
-- dashboard — optionally tagged to a goal or liability so that item's
-- progress updates itself.
-- ---------------------------------------------------------------
create table public.bt_expense_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in (
    'Housing', 'Utilities', 'Transport', 'Food', 'Personal',
    'Insurance', 'Debt Repayment', 'Savings & Investments', 'Education', 'Other'
  )),
  amount numeric not null check (amount > 0),
  expense_date date not null default current_date,
  goal_id uuid references public.bt_goals(id) on delete set null,
  liability_id uuid references public.bt_liabilities(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index bt_income_entries_user_date_idx on public.bt_income_entries (user_id, entry_date desc);
create index bt_expense_entries_user_date_idx on public.bt_expense_entries (user_id, expense_date desc);
create index bt_expense_entries_goal_idx on public.bt_expense_entries (goal_id) where goal_id is not null;
create index bt_expense_entries_liability_idx on public.bt_expense_entries (liability_id) where liability_id is not null;
create index bt_profiles_agent_idx on public.bt_profiles (agent_id) where agent_id is not null;

-- keep goals/liabilities updated_at honest
create or replace function public.bt_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger bt_goals_set_updated_at before update on public.bt_goals
  for each row execute function public.bt_set_updated_at();
create trigger bt_liabilities_set_updated_at before update on public.bt_liabilities
  for each row execute function public.bt_set_updated_at();

-- ---------------------------------------------------------------
-- Progress views — saved/paid amounts computed live from linked
-- entries rather than stored+trigger-maintained, so there's no way
-- for them to drift out of sync. security_invoker means each view
-- runs under the querying user's own RLS, not the view owner's.
-- ---------------------------------------------------------------
create view public.bt_goal_progress
with (security_invoker = true) as
select
  g.*,
  g.opening_amount + coalesce(sum(e.amount), 0) as saved_amount,
  case when g.target_amount > 0
    then least(1, (g.opening_amount + coalesce(sum(e.amount), 0)) / g.target_amount)
    else 0
  end as progress_pct
from public.bt_goals g
left join public.bt_expense_entries e on e.goal_id = g.id
group by g.id;

create view public.bt_liability_progress
with (security_invoker = true) as
select
  l.*,
  coalesce(sum(e.amount), 0) as paid_via_tracker,
  greatest(0, l.current_balance - coalesce(sum(e.amount), 0)) as estimated_remaining
from public.bt_liabilities l
left join public.bt_expense_entries e on e.liability_id = l.id
group by l.id;

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------
alter table public.bt_profiles enable row level security;
alter table public.bt_goals enable row level security;
alter table public.bt_liabilities enable row level security;
alter table public.bt_income_entries enable row level security;
alter table public.bt_expense_entries enable row level security;

-- Is target_user one of the calling agent's assigned clients?
create or replace function public.bt_is_my_client(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bt_profiles p
    where p.id = target_user and p.agent_id = auth.uid()
  );
$$;

-- Profiles: see your own row, or (if you're the assigned agent) your client's.
create policy "bt_profiles_select_own_or_agent" on public.bt_profiles
  for select to authenticated
  using (id = auth.uid() or agent_id = auth.uid());

create policy "bt_profiles_update_own" on public.bt_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- RLS is row-level only — it can't stop a client from PATCHing their own
-- `role` or `agent_id` column straight through PostgREST. Column-level
-- grants close that gap: only the fields the app's Settings form actually
-- edits are updatable by a normal authenticated request. bt_claim_client()
-- can still set agent_id because SECURITY DEFINER functions run with the
-- function owner's privileges, not the caller's — these grants don't apply
-- to it.
revoke update on public.bt_profiles from authenticated;
grant update (full_name, currency, annual_savings_target_pct, model_year) on public.bt_profiles to authenticated;

-- Goals / Liabilities / Income / Expenses: client owns and edits their own
-- rows; their assigned agent gets read-only visibility, nothing more.
create policy "bt_goals_select" on public.bt_goals
  for select to authenticated using (user_id = auth.uid() or bt_is_my_client(user_id));
create policy "bt_goals_write" on public.bt_goals
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "bt_liabilities_select" on public.bt_liabilities
  for select to authenticated using (user_id = auth.uid() or bt_is_my_client(user_id));
create policy "bt_liabilities_write" on public.bt_liabilities
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "bt_income_select" on public.bt_income_entries
  for select to authenticated using (user_id = auth.uid() or bt_is_my_client(user_id));
create policy "bt_income_write" on public.bt_income_entries
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "bt_expense_select" on public.bt_expense_entries
  for select to authenticated using (user_id = auth.uid() or bt_is_my_client(user_id));
create policy "bt_expense_write" on public.bt_expense_entries
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------
-- Agent <-> client linking. An agent claims a client by email; this
-- runs as SECURITY DEFINER so it can set agent_id on someone else's
-- profile under controlled conditions, without opening that column
-- up to a general-purpose RLS update policy.
-- ---------------------------------------------------------------
create or replace function public.bt_claim_client(client_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_id uuid;
  v_role text;
begin
  select role into v_caller_role from public.bt_profiles where id = auth.uid();
  if v_caller_role is distinct from 'agent' then
    return jsonb_build_object('ok', false, 'error', 'not_an_agent');
  end if;

  select id, role into v_id, v_role from public.bt_profiles where lower(email) = lower(client_email);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_account');
  end if;
  if v_role is distinct from 'client' then
    return jsonb_build_object('ok', false, 'error', 'not_a_client');
  end if;

  update public.bt_profiles set agent_id = auth.uid() where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function public.bt_claim_client(text) to authenticated;
grant execute on function public.bt_is_my_client(uuid) to authenticated;

-- ---------------------------------------------------------------
-- To promote a user to an agent (there's no self-serve signup for
-- this — Black Tree staff only), run by hand in the Supabase SQL
-- editor after they've logged in once via magic link:
--
--   update public.bt_profiles set role = 'agent' where email = 'agent@blacktreeinvestments.com';
-- ---------------------------------------------------------------
