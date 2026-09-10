-- ============================================================
-- Client-controlled agent linking, and a single admin role.
--
-- Previously an agent could link themselves to any client just by
-- typing that client's email — no consent step on the client's side.
-- This replaces that with a one-time code: the client generates it in
-- their own Dashboard and hands it to their advisor directly (in
-- person, by phone/text); the advisor needs both the client's email
-- AND that code to establish the link. Nothing links without the
-- client's own action, and the client can remove access at any time.
--
-- 'admin' is a new role, held by one account, who oversees the whole
-- roster of links and who is allowed to be an agent at all. Admin
-- access is deliberately narrow: it reaches bt_profiles only (email,
-- role, who's linked to whom), never a client's actual income,
-- expenses, goals, debts, or bills — those stay exactly as private as
-- privacy.html already promises.
-- ============================================================

alter table public.bt_profiles drop constraint if exists bt_profiles_role_check;
alter table public.bt_profiles add constraint bt_profiles_role_check
  check (role in ('client', 'agent', 'admin'));

create or replace function public.bt_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.bt_profiles where id = auth.uid() and role = 'admin');
$$;

grant execute on function public.bt_is_admin() to authenticated;

-- Admin can see every profile row (to manage the roster); everyone
-- else still only sees their own row or, if they're an agent, their
-- assigned clients' rows. This replaces the earlier, narrower policy.
drop policy if exists "bt_profiles_select_own_or_agent" on public.bt_profiles;
create policy "bt_profiles_select_own_or_agent_or_admin" on public.bt_profiles
  for select to authenticated
  using (id = auth.uid() or agent_id = auth.uid() or bt_is_admin());

-- ---------------------------------------------------------------
-- Link codes.
-- ---------------------------------------------------------------
create table public.bt_link_codes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_agent_id uuid references auth.users(id) on delete set null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index bt_link_codes_client_idx on public.bt_link_codes (client_id);

alter table public.bt_link_codes enable row level security;
create policy "bt_link_codes_select_own" on public.bt_link_codes
  for select to authenticated using (client_id = auth.uid());

-- Client generates a fresh 6-digit code for themselves, good for 30
-- minutes and one use. Any earlier unused code is invalidated first,
-- so only the newest one is ever live.
create or replace function public.bt_generate_link_code()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_code text;
  v_expires timestamptz;
begin
  select role into v_role from public.bt_profiles where id = auth.uid();
  if v_role is distinct from 'client' then
    return jsonb_build_object('ok', false, 'error', 'not_a_client');
  end if;

  update public.bt_link_codes set expires_at = now() where client_id = auth.uid() and used_at is null;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  v_expires := now() + interval '30 minutes';
  insert into public.bt_link_codes (client_id, code, expires_at) values (auth.uid(), v_code, v_expires);

  return jsonb_build_object('ok', true, 'code', v_code, 'expires_at', v_expires);
end;
$$;

grant execute on function public.bt_generate_link_code() to authenticated;

-- Agent redeems a client's code to establish the link. A code is a bare
-- 6-digit number, so it's guessable by brute force if nothing stops
-- repeated tries — this locks the *current* pending code out after 5
-- wrong guesses (forcing the client to generate a fresh one) rather than
-- leaving an agent free to try all 1,000,000 combinations within the
-- 30-minute window.
create or replace function public.bt_redeem_link_code(p_client_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_client_id uuid;
  v_client_role text;
  v_code_row record;
begin
  select role into v_caller_role from public.bt_profiles where id = auth.uid();
  if v_caller_role is distinct from 'agent' then
    return jsonb_build_object('ok', false, 'error', 'not_an_agent');
  end if;

  select id, role into v_client_id, v_client_role from public.bt_profiles where lower(email) = lower(p_client_email);
  if v_client_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_account');
  end if;
  if v_client_role is distinct from 'client' then
    return jsonb_build_object('ok', false, 'error', 'not_a_client');
  end if;

  select * into v_code_row from public.bt_link_codes
    where client_id = v_client_id and used_at is null and expires_at > now()
    order by created_at desc limit 1;

  if v_code_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  if v_code_row.attempts >= 5 then
    update public.bt_link_codes set expires_at = now() where id = v_code_row.id;
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  if v_code_row.code is distinct from p_code then
    update public.bt_link_codes set attempts = attempts + 1 where id = v_code_row.id;
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  update public.bt_link_codes set used_at = now(), used_by_agent_id = auth.uid() where id = v_code_row.id;
  update public.bt_profiles set agent_id = auth.uid() where id = v_client_id;

  return jsonb_build_object('ok', true, 'id', v_client_id);
end;
$$;

grant execute on function public.bt_redeem_link_code(text, text) to authenticated;

-- Client can remove their advisor's access at any time — consent
-- has to work both ways.
create or replace function public.bt_client_unlink_agent()
returns void
language sql
security definer
set search_path = public
as $$
  update public.bt_profiles set agent_id = null where id = auth.uid();
$$;

grant execute on function public.bt_client_unlink_agent() to authenticated;

-- ---------------------------------------------------------------
-- Admin: sole authority for promoting/demoting roles, and a
-- force-link/unlink override for support (day-to-day linking is the
-- client's code above, not this).
-- ---------------------------------------------------------------
create or replace function public.bt_admin_set_role(target_email text, new_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
begin
  if not bt_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_an_admin');
  end if;
  if new_role not in ('client', 'agent', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'bad_role');
  end if;

  select id into v_target from public.bt_profiles where lower(email) = lower(target_email);
  if v_target is null then
    return jsonb_build_object('ok', false, 'error', 'no_account');
  end if;

  update public.bt_profiles set role = new_role where id = v_target;
  return jsonb_build_object('ok', true, 'id', v_target);
end;
$$;

grant execute on function public.bt_admin_set_role(text, text) to authenticated;

create or replace function public.bt_admin_set_link(client_email text, agent_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_agent uuid;
begin
  if not bt_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_an_admin');
  end if;

  select id into v_client from public.bt_profiles where lower(email) = lower(client_email) and role = 'client';
  if v_client is null then
    return jsonb_build_object('ok', false, 'error', 'no_client');
  end if;

  if agent_email is null or agent_email = '' then
    update public.bt_profiles set agent_id = null where id = v_client;
    return jsonb_build_object('ok', true, 'id', v_client, 'unlinked', true);
  end if;

  select id into v_agent from public.bt_profiles where lower(email) = lower(agent_email) and role = 'agent';
  if v_agent is null then
    return jsonb_build_object('ok', false, 'error', 'no_agent');
  end if;

  update public.bt_profiles set agent_id = v_agent where id = v_client;
  return jsonb_build_object('ok', true, 'id', v_client);
end;
$$;

grant execute on function public.bt_admin_set_link(text, text) to authenticated;

-- The old email-only claim path is retired now that linking requires
-- the client's own code.
drop function if exists public.bt_claim_client(text);

-- ---------------------------------------------------------------
-- To make the first admin: promote an existing account (they must
-- have already signed in at least once), then have them open
-- admin.html while signed in to set a password for themselves —
-- that's what lets them sign in there with a password afterward
-- instead of a magic link.
--
--   update public.bt_profiles set role = 'admin' where email = 'you@blacktreeinvestments.com';
-- ---------------------------------------------------------------
