-- Safe to re-run. Run this file on its own (not the whole schema.sql).
alter table public.properties add column if not exists photos text[] not null default '{}';
alter table public.properties add column if not exists amenities text[] not null default '{}';

insert into storage.buckets (id, name, public) values ('property-photos', 'property-photos', true) on conflict (id) do nothing;
drop policy if exists "Owners upload property photos" on storage.objects;
create policy "Owners upload property photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Owners delete property photos" on storage.objects;
create policy "Owners delete property photos" on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

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
grant execute on function public.site_info(text) to anon, authenticated;
