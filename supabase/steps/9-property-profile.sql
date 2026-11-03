-- Full property profile: address, bathrooms, capacity, check-in/out times, cleaning fee,
-- per-property commission and assigned cleaners. Safe to run more than once.
alter table public.properties add column if not exists address text not null default '';
alter table public.properties add column if not exists bathrooms numeric(3, 1) not null default 1 check (bathrooms >= 0);
alter table public.properties add column if not exists max_guests integer not null default 2 check (max_guests > 0);
alter table public.properties add column if not exists check_in_time text not null default '15:00';
alter table public.properties add column if not exists check_out_time text not null default '11:00';
alter table public.properties add column if not exists cleaning_fee numeric(12, 2) not null default 0 check (cleaning_fee >= 0);
-- null means "use the owner's default management fee"
alter table public.properties add column if not exists commission_pct numeric(5, 2) check (commission_pct between 0 and 100);
alter table public.properties add column if not exists cleaner_ids uuid[] not null default '{}';
