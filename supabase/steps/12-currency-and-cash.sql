-- JMD / USD transaction currencies with recorded exchange rates, plus money actually received
-- (payments) and money paid out to owners (payouts). Safe to run more than once.
-- exchange_rate is always "Jamaican dollars per 1 US dollar" on the day of the transaction.
-- A null rate means "no rate recorded"; the app then falls back to your default rate in Settings.

alter table public.reservations add column if not exists currency text not null default 'USD';
alter table public.reservations add column if not exists exchange_rate numeric(12, 4);
alter table public.expenses add column if not exists currency text not null default 'USD';
alter table public.expenses add column if not exists exchange_rate numeric(12, 4);

alter table public.reservations drop constraint if exists reservations_currency_check;
alter table public.reservations add constraint reservations_currency_check check (currency in ('USD', 'JMD'));
alter table public.reservations drop constraint if exists reservations_exchange_rate_check;
alter table public.reservations add constraint reservations_exchange_rate_check check (exchange_rate is null or exchange_rate > 0);
alter table public.expenses drop constraint if exists expenses_currency_check;
alter table public.expenses add constraint expenses_currency_check check (currency in ('USD', 'JMD'));
alter table public.expenses drop constraint if exists expenses_exchange_rate_check;
alter table public.expenses add constraint expenses_exchange_rate_check check (exchange_rate is null or exchange_rate > 0);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_id_user_key') then
    alter table public.reservations add constraint reservations_id_user_key unique (id, user_id);
  end if;
end $$;

-- Money actually received against a reservation (deposits, part payments, balances)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reservation_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'USD' check (currency in ('USD', 'JMD')),
  exchange_rate numeric(12, 4) check (exchange_rate is null or exchange_rate > 0),
  received_on date not null,
  method text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint payments_reservation_owner_fkey
    foreign key (reservation_id, user_id)
    references public.reservations (id, user_id)
    on delete cascade
);
create index if not exists payments_user_date_idx on public.payments (user_id, received_on);

-- Money actually paid out to a property owner
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'USD' check (currency in ('USD', 'JMD')),
  exchange_rate numeric(12, 4) check (exchange_rate is null or exchange_rate > 0),
  paid_on date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint payouts_owner_fkey
    foreign key (owner_id, user_id)
    references public.owners (id, user_id)
    on delete cascade
);
create index if not exists payouts_user_date_idx on public.payouts (user_id, paid_on);

alter table public.payments enable row level security;
alter table public.payouts enable row level security;
revoke all on public.payments, public.payouts from anon;
grant select, insert, update, delete on public.payments, public.payouts to authenticated;

do $$
declare t text;
begin
  foreach t in array array['payments', 'payouts'] loop
    execute format('drop policy if exists "Owners can read their %1$s" on public.%1$s', t);
    execute format('create policy "Owners can read their %1$s" on public.%1$s for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('drop policy if exists "Owners can add their %1$s" on public.%1$s', t);
    execute format('create policy "Owners can add their %1$s" on public.%1$s for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('drop policy if exists "Owners can update their %1$s" on public.%1$s', t);
    execute format('create policy "Owners can update their %1$s" on public.%1$s for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('drop policy if exists "Owners can delete their %1$s" on public.%1$s', t);
    execute format('create policy "Owners can delete their %1$s" on public.%1$s for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;
