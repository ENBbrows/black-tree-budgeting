-- ============================================================
-- Payment method tracking — how money actually moved, on both
-- income and expense entries: Cash, Debit Card, Credit Card, Cheque,
-- Bank Transfer, Mobile Payment, Other, plus an optional free-text
-- name for which specific card/account (e.g. "Republic Visa").
-- Both columns are optional so existing entries aren't broken.
-- ============================================================

alter table public.bt_expense_entries add column payment_type text;
alter table public.bt_expense_entries add constraint bt_expense_entries_payment_type_check
  check (payment_type is null or payment_type in (
    'Cash', 'Debit Card', 'Credit Card', 'Cheque', 'Bank Transfer', 'Mobile Payment', 'Other'
  ));
alter table public.bt_expense_entries add column payment_account text;

alter table public.bt_income_entries add column payment_type text;
alter table public.bt_income_entries add constraint bt_income_entries_payment_type_check
  check (payment_type is null or payment_type in (
    'Cash', 'Debit Card', 'Credit Card', 'Cheque', 'Bank Transfer', 'Mobile Payment', 'Other'
  ));
alter table public.bt_income_entries add column payment_account text;
