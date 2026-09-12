-- ============================================================
-- Vacation Vault — a client-set percentage of disposable income to
-- set aside once every base is covered (Emergency Fund, Critical
-- Illness Fund, and Burial Fund all fully funded via their linked
-- goals). The app gates the UI on that condition; this just stores
-- the percentage the client chooses once it unlocks.
-- ============================================================

alter table public.bt_profiles
  add column vacation_vault_pct numeric not null default 10 check (vacation_vault_pct >= 0 and vacation_vault_pct <= 100);

grant update (vacation_vault_pct) on public.bt_profiles to authenticated;
