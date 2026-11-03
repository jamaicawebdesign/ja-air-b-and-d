-- Add explicit platform-commission expense tracking for reports and owner statements.
alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category in ('cleaning', 'maintenance', 'platform_commission', 'utilities', 'supplies', 'marketing', 'taxes', 'other'));
