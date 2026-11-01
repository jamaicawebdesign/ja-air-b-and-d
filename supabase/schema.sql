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

-- Unified inbox & guest communication (run this block after the sections above)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete set null,
  guest_name text not null check (char_length(trim(guest_name)) between 1 and 120),
  guest_contact text not null default '',
  channel text not null check (channel in ('airbnb', 'whatsapp', 'email', 'booking', 'vrbo', 'sms')),
  unread integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  status text not null default 'sent' check (status in ('sent', 'queued')),
  trigger_key text,
  created_at timestamptz not null default now()
);

-- One automated message per trigger per reservation
create unique index if not exists messages_trigger_once_idx
  on public.messages (reservation_id, trigger_key) where trigger_key is not null and reservation_id is not null;
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trigger text not null check (trigger in ('booking_confirmation', 'pre_arrival', 'check_out', 'review_request', 'auto_reply')),
  name text not null check (char_length(trim(name)) between 1 and 80),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  offset_days integer not null default 0 check (offset_days between -30 and 30),
  keywords text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_templates enable row level security;
revoke all on public.conversations, public.messages, public.message_templates from anon;
grant select, insert, update, delete on public.conversations, public.messages, public.message_templates to authenticated;

do $$
declare t text;
begin
  foreach t in array array['conversations', 'messages', 'message_templates'] loop
    execute format('create policy "Owners can read their %1$s" on public.%1$s for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "Owners can add their %1$s" on public.%1$s for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "Owners can update their %1$s" on public.%1$s for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "Owners can delete their %1$s" on public.%1$s for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Operations & cleaning automation (run this block after the sections above)
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  phone text not null default '',
  role text not null default 'cleaner' check (role in ('cleaner', 'maintenance', 'manager')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  property_id uuid not null,
  reservation_id uuid references public.reservations (id) on delete set null,
  staff_id uuid references public.staff (id) on delete set null,
  kind text not null default 'cleaning' check (kind in ('cleaning', 'maintenance')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  notes text not null default '',
  due_date date not null,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  auto boolean not null default false,
  notified_at timestamptz,
  photo_paths text[] not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tasks_property_owner_fkey
    foreign key (property_id, user_id)
    references public.properties (id, user_id)
    on delete cascade
);

-- One automatic turnover task per reservation
create unique index if not exists tasks_auto_once_idx on public.tasks (reservation_id) where auto and reservation_id is not null;
create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date);

alter table public.staff enable row level security;
alter table public.tasks enable row level security;
revoke all on public.staff, public.tasks from anon;
grant select, insert, update, delete on public.staff, public.tasks to authenticated;

do $$
declare t text;
begin
  foreach t in array array['staff', 'tasks'] loop
    execute format('create policy "Owners can read their %1$s" on public.%1$s for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "Owners can add their %1$s" on public.%1$s for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "Owners can update their %1$s" on public.%1$s for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "Owners can delete their %1$s" on public.%1$s for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Private storage for task photo proof; each owner can only touch their own folder
insert into storage.buckets (id, name, public) values ('task-photos', 'task-photos', false) on conflict (id) do nothing;
create policy "Owners read task photos" on storage.objects for select to authenticated
  using (bucket_id = 'task-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners upload task photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners delete task photos" on storage.objects for delete to authenticated
  using (bucket_id = 'task-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Owner portals & financial reporting (run this block after the sections above)
create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  email text not null default '',
  phone text not null default '',
  fee_pct numeric(5, 2) not null default 15 check (fee_pct between 0 and 100),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

alter table public.properties add column if not exists owner_id uuid references public.owners (id) on delete set null;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  property_id uuid not null,
  category text not null default 'other' check (category in ('cleaning', 'maintenance', 'utilities', 'supplies', 'marketing', 'taxes', 'other')),
  description text not null default '',
  amount numeric(12, 2) not null check (amount >= 0),
  expense_date date not null,
  created_at timestamptz not null default now(),
  constraint expenses_property_owner_fkey
    foreign key (property_id, user_id)
    references public.properties (id, user_id)
    on delete cascade
);
create index if not exists expenses_user_date_idx on public.expenses (user_id, expense_date);

alter table public.owners enable row level security;
alter table public.expenses enable row level security;
revoke all on public.owners, public.expenses from anon;
grant select, insert, update, delete on public.owners, public.expenses to authenticated;

do $$
declare t text;
begin
  foreach t in array array['owners', 'expenses'] loop
    execute format('create policy "Owners can read their %1$s" on public.%1$s for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "Owners can add their %1$s" on public.%1$s for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "Owners can update their %1$s" on public.%1$s for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "Owners can delete their %1$s" on public.%1$s for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Direct booking website & engine (run this block after the sections above)
alter table public.properties add column if not exists listed boolean not null default false;

create table if not exists public.booking_sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$'),
  brand_name text not null check (char_length(trim(brand_name)) between 1 and 80),
  tagline text not null default '' check (char_length(tagline) <= 160),
  contact_email text not null default '',
  contact_phone text not null default '',
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.booking_sites enable row level security;
revoke all on public.booking_sites from anon;
grant select, insert, update, delete on public.booking_sites to authenticated;
create policy "Owners can read their booking site" on public.booking_sites for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners can add their booking site" on public.booking_sites for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owners can update their booking site" on public.booking_sites for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Owners can delete their booking site" on public.booking_sites for delete to authenticated using ((select auth.uid()) = user_id);

-- Public site content: only enabled sites and only listed properties
create or replace function public.site_info(p_slug text)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'brand_name', s.brand_name,
    'tagline', s.tagline,
    'contact_email', s.contact_email,
    'contact_phone', s.contact_phone,
    'properties', coalesce((
      select json_agg(json_build_object('id', p.id, 'name', p.name, 'location', p.location,
        'bedrooms', p.bedrooms, 'rate', p.rate, 'description', p.description,
        'photos', to_json(p.photos), 'amenities', to_json(p.amenities)) order by p.created_at)
      from public.properties p where p.user_id = s.user_id and p.listed), '[]'::json))
  from public.booking_sites s
  where s.slug = lower(p_slug) and s.enabled;
$$;

-- Blocked dates only (no guest details)
create or replace function public.site_busy(p_slug text, p_property uuid)
returns table (check_in date, check_out date)
language sql
security definer
set search_path = public
as $$
  select r.check_in, r.check_out
  from public.booking_sites s
  join public.properties p on p.user_id = s.user_id and p.id = p_property and p.listed
  join public.reservations r on r.property_id = p.id and r.user_id = s.user_id
  where s.slug = lower(p_slug) and s.enabled and r.status <> 'cancelled' and r.check_out >= current_date;
$$;

-- Creates a pending direct reservation after validating dates and availability
create or replace function public.site_book(
  p_slug text, p_property uuid, p_guest text, p_email text, p_phone text,
  p_check_in date, p_check_out date, p_guests integer, p_notes text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.booking_sites;
  v_prop public.properties;
  v_nights integer;
  v_id uuid;
begin
  select * into v_site from public.booking_sites where slug = lower(p_slug) and enabled;
  if not found then raise exception 'This booking site is not available.'; end if;
  select * into v_prop from public.properties where id = p_property and user_id = v_site.user_id and listed;
  if not found then raise exception 'This property is not available.'; end if;

  if char_length(trim(coalesce(p_guest, ''))) not between 1 and 120 then raise exception 'Please enter your name.'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_email) > 200 then raise exception 'Please enter a valid email.'; end if;
  if p_check_in is null or p_check_out is null or p_check_in < current_date or p_check_out <= p_check_in then
    raise exception 'Please choose valid dates.';
  end if;
  v_nights := p_check_out - p_check_in;
  if v_nights > 60 then raise exception 'Stays are limited to 60 nights.'; end if;
  if coalesce(p_guests, 0) < 1 or p_guests > 50 then raise exception 'Please enter the number of guests.'; end if;

  perform pg_advisory_xact_lock(hashtext(p_property::text));
  if exists (
    select 1 from public.reservations r
    where r.property_id = p_property and r.status <> 'cancelled'
      and r.check_in < p_check_out and r.check_out > p_check_in
  ) then raise exception 'Those dates are no longer available.'; end if;

  if (select count(*) from public.reservations r
      where r.user_id = v_site.user_id and r.status = 'pending' and lower(r.email) = lower(p_email)
        and r.created_at > now() - interval '1 day') >= 3 then
    raise exception 'Too many pending requests. Please wait for the host to respond.';
  end if;

  insert into public.reservations (user_id, property_id, guest, email, phone, check_in, check_out, guests, amount, status, notes, source)
  values (v_site.user_id, p_property, trim(p_guest), trim(p_email), left(coalesce(p_phone, ''), 40), p_check_in, p_check_out,
          p_guests, v_prop.rate * v_nights, 'pending', left('Direct booking request. ' || coalesce(p_notes, ''), 1000), 'direct')
  returning id into v_id;
  return json_build_object('id', v_id, 'total', v_prop.rate * v_nights, 'nights', v_nights);
end;
$$;

revoke all on function public.site_info(text), public.site_busy(text, uuid),
  public.site_book(text, uuid, text, text, text, date, date, integer, text) from public;
grant execute on function public.site_info(text), public.site_busy(text, uuid),
  public.site_book(text, uuid, text, text, text, date, date, integer, text) to anon, authenticated;

-- Listing photos & amenities for the direct booking site (run this block after the sections above,
-- then re-run the site_info function above so it returns photos and amenities)
alter table public.properties add column if not exists photos text[] not null default '{}';
alter table public.properties add column if not exists amenities text[] not null default '{}';

-- Public bucket so guests can see listing photos; owners can only write inside their own folder
insert into storage.buckets (id, name, public) values ('property-photos', 'property-photos', true) on conflict (id) do nothing;
create policy "Owners upload property photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners delete property photos" on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
