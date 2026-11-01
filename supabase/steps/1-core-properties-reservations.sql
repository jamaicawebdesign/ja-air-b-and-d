create extension if not exists pgcrypto;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  location text not null check (char_length(trim(location)) between 1 and 180),
  bedrooms integer not null check (bedrooms > 0),
  rate numeric(12, 2) not null check (rate >= 0),
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  property_id uuid not null,
  guest text not null check (char_length(trim(guest)) between 1 and 120),
  email text not null,
  phone text not null default '',
  check_in date not null,
  check_out date not null,
  guests integer not null check (guests > 0),
  amount numeric(12, 2) not null check (amount >= 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'pending', 'cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  check (check_out > check_in),
  constraint reservations_property_owner_fkey
    foreign key (property_id, user_id)
    references public.properties (id, user_id)
    on delete restrict
);

create index if not exists properties_user_id_created_at_idx
  on public.properties (user_id, created_at);
create index if not exists reservations_user_id_check_in_idx
  on public.reservations (user_id, check_in);

alter table public.properties enable row level security;
alter table public.reservations enable row level security;
revoke all on public.properties, public.reservations from anon;
grant select, insert, update, delete on public.properties, public.reservations to authenticated;

drop policy if exists "Owners can read their properties" on public.properties;
create policy "Owners can read their properties"
  on public.properties for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Owners can add their properties" on public.properties;
create policy "Owners can add their properties"
  on public.properties for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Owners can update their properties" on public.properties;
create policy "Owners can update their properties"
  on public.properties for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Owners can delete their properties" on public.properties;
create policy "Owners can delete their properties"
  on public.properties for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Owners can read their reservations" on public.reservations;
create policy "Owners can read their reservations"
  on public.reservations for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Owners can add their reservations" on public.reservations;
create policy "Owners can add their reservations"
  on public.reservations for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Owners can update their reservations" on public.reservations;
create policy "Owners can update their reservations"
  on public.reservations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Owners can delete their reservations" on public.reservations;
create policy "Owners can delete their reservations"
  on public.reservations for delete to authenticated
  using ((select auth.uid()) = user_id);
