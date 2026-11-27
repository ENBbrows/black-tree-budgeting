-- Every brand-new signup needs a default "Personal" book too, now that
-- income/expenses/goals/liabilities/bills/documents/projects all require
-- a book_id. Redefining bt_handle_new_user() in place — the existing
-- trigger (bt_on_auth_user_created, from migration 0001) already points
-- at this function by name, so it picks up the new behavior with no
-- change to the trigger itself.
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

  insert into public.bt_books (user_id, name, is_default)
  select new.id, 'Personal', true
  where not exists (select 1 from public.bt_books where user_id = new.id);

  return new;
end;
$$;
