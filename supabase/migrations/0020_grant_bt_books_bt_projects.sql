-- Every other table here got its baseline authenticated-role privileges
-- from this project's original setup; bt_books (just added) and
-- bt_projects (added earlier for business accounts, never actually
-- exercised against this live database until now) both missed it,
-- silently blocking every insert/update a client tried to make even
-- though their RLS policies were correct — the row simply never landed.
grant select, insert, update, delete on public.bt_books to authenticated;
grant select, insert, update, delete on public.bt_projects to authenticated;
