-- Date of birth, used to gate the Burial Fund section to clients 50 and over.
alter table public.bt_profiles add column if not exists date_of_birth date;
