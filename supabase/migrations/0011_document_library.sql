-- ============================================================
-- Document Library — private accounting records: bank-transfer
-- screenshots (proof of income/payment) and bill/receipt photos.
-- Each row is metadata; the actual image lives in a private Storage
-- bucket, one file per row, never a public URL — the app always reads
-- it back through a short-lived signed URL. Strictly owner-only: even
-- an agent with dashboard access to a client's numbers cannot see
-- their documents, since these can carry account numbers and other
-- identifying detail that goes well beyond the aggregated figures an
-- agent is meant to see.
-- ============================================================

create table public.bt_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  doc_type text not null check (doc_type in ('bank_transfer', 'bill', 'other')),
  bank_name text,
  category text,
  amount numeric,
  doc_date date not null,
  notes text,
  storage_path text not null unique,
  income_id uuid references public.bt_income_entries(id) on delete set null,
  expense_id uuid references public.bt_expense_entries(id) on delete set null,
  created_at timestamptz not null default now()
);

create index bt_documents_user_idx on public.bt_documents (user_id, doc_date desc);

alter table public.bt_documents enable row level security;

create policy "bt_documents_select_own" on public.bt_documents
  for select to authenticated
  using (user_id = auth.uid());

create policy "bt_documents_insert_own" on public.bt_documents
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "bt_documents_update_own" on public.bt_documents
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "bt_documents_delete_own" on public.bt_documents
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.bt_documents to authenticated;

-- ---------------------------------------------------------------
-- Storage bucket + policies. Private bucket — files are only ever
-- reached via a signed URL generated for the owning user. Each
-- object's path is prefixed with the owner's uid ("<uid>/<doc id>.<ext>"),
-- and the policies check that prefix against auth.uid() so one
-- client's files are never reachable by another's session.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('bt-documents', 'bt-documents', false)
  on conflict (id) do nothing;

create policy "bt_documents_storage_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'bt-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "bt_documents_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bt-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "bt_documents_storage_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'bt-documents' and (storage.foldername(name))[1] = auth.uid()::text);
