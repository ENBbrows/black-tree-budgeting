-- ============================================================
-- Taxes as a first-class category, and debt payoff targets.
-- ============================================================

-- "Taxes" joins the category list everywhere a category is checked, so
-- setting aside for and paying taxes works exactly like any other
-- category — budgets, bills, the cash flow statement, all of it.
alter table public.bt_expense_entries drop constraint if exists bt_expense_entries_category_check;
alter table public.bt_expense_entries add constraint bt_expense_entries_category_check
  check (category in (
    'Housing', 'Utilities', 'Transport', 'Food', 'Personal',
    'Insurance', 'Debt Repayment', 'Savings & Investments', 'Education', 'Taxes', 'Other'
  ));

alter table public.bt_recurring_bills drop constraint if exists bt_recurring_bills_category_check;
alter table public.bt_recurring_bills add constraint bt_recurring_bills_category_check
  check (category in (
    'Housing', 'Utilities', 'Transport', 'Food', 'Personal',
    'Insurance', 'Debt Repayment', 'Savings & Investments', 'Education', 'Taxes', 'Other'
  ));

-- A debt can now carry a target payoff date, same idea as a goal's
-- target_date — progress gets paced against it (on track / behind),
-- not just shown as a raw percentage.
alter table public.bt_liabilities add column target_payoff_date date;
