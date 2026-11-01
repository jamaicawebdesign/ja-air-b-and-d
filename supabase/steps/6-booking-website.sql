-- Direct booking website & engine (run this block after the sections above)
alter table public.properties add column if not exists listed boolean not null default false;
alter table public.properties add column if not exists photos text[] not null default '{}';
alter table public.properties add column if not exists amenities text[] not null default '{}';

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
drop policy if exists "Owners can read their booking site" on public.booking_sites;
create policy "Owners can read their booking site" on public.booking_sites for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Owners can add their booking site" on public.booking_sites;
create policy "Owners can add their booking site" on public.booking_sites for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Owners can update their booking site" on public.booking_sites;
create policy "Owners can update their booking site" on public.booking_sites for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Owners can delete their booking site" on public.booking_sites;
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
