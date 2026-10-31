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

create policy "Owners can read their properties"
  on public.properties for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Owners can add their properties"
  on public.properties for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Owners can update their properties"
  on public.properties for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owners can delete their properties"
  on public.properties for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owners can read their reservations"
  on public.reservations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Owners can add their reservations"
  on public.reservations for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Owners can update their reservations"
  on public.reservations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owners can delete their reservations"
  on public.reservations for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Channel management (run this block after the tables above)
alter table public.reservations
  add column if not exists source text not null default 'direct',
  add column if not exists channel_id uuid,
  add column if not exists external_uid text;

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  property_id uuid not null,
  platform text not null check (platform in ('airbnb', 'vrbo', 'booking', 'other')),
  ical_url text not null default '',
  price_adjust_pct numeric(6, 2) not null default 0 check (price_adjust_pct between -90 and 500),
  export_token uuid not null default gen_random_uuid() unique,
  last_synced_at timestamptz,
  last_status text not null default 'never synced',
  created_at timestamptz not null default now(),
  constraint channels_property_owner_fkey
    foreign key (property_id, user_id)
    references public.properties (id, user_id)
    on delete cascade
);

do $$ begin
  alter table public.reservations
    add constraint reservations_channel_fkey
    foreign key (channel_id) references public.channels (id) on delete set null;
exception when duplicate_object then null; end $$;

create unique index if not exists reservations_channel_uid_idx
  on public.reservations (channel_id, external_uid) where channel_id is not null;

alter table public.channels enable row level security;
revoke all on public.channels from anon;
grant select, insert, update, delete on public.channels to authenticated;

create policy "Owners can read their channels"
  on public.channels for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Owners can add their channels"
  on public.channels for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Owners can update their channels"
  on public.channels for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owners can delete their channels"
  on public.channels for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Public calendar feed: knowing the secret token is the only access. It returns
-- every blocked date for the property except stays that came from this channel.
create or replace function public.channel_feed(p_token uuid)
returns table (uid text, check_in date, check_out date, summary text)
language sql
security definer
set search_path = public
as $$
  select r.id::text, r.check_in, r.check_out, 'Reserved'
  from public.channels c
  join public.reservations r on r.property_id = c.property_id and r.user_id = c.user_id
  where c.export_token = p_token
    and r.status <> 'cancelled'
    and r.channel_id is distinct from c.id;
$$;
revoke all on function public.channel_feed(uuid) from public;
grant execute on function public.channel_feed(uuid) to anon, authenticated;
