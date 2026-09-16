-- Fix: date_of_birth (added in 0012) was missing its update grant, which
-- made every Settings save that included it fail silently once synced —
-- not just that field, the whole update. Safe to run even if 0012's
-- column already exists.
grant update (date_of_birth) on public.bt_profiles to authenticated;

-- Car & Property Insurance renewal tracking — annual premium + renewal
-- date, tracked toward from linked "Car Insurance" / "Property Insurance"
-- goals the same way Burial Fund etc. are.
alter table public.bt_profiles add column if not exists car_insurance_premium numeric;
alter table public.bt_profiles add column if not exists car_insurance_renewal_date date;
alter table public.bt_profiles add column if not exists property_insurance_premium numeric;
alter table public.bt_profiles add column if not exists property_insurance_renewal_date date;

grant update (
  car_insurance_premium, car_insurance_renewal_date,
  property_insurance_premium, property_insurance_renewal_date
) on public.bt_profiles to authenticated;
