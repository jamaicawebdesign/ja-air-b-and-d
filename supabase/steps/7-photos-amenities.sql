-- Listing photos & amenities for the direct booking site (run this block after the sections above,
-- then re-run the site_info function above so it returns photos and amenities)
alter table public.properties add column if not exists photos text[] not null default '{}';
alter table public.properties add column if not exists amenities text[] not null default '{}';

-- Public bucket so guests can see listing photos; owners can only write inside their own folder
insert into storage.buckets (id, name, public) values ('property-photos', 'property-photos', true) on conflict (id) do nothing;
drop policy if exists "Owners upload property photos" on storage.objects;
create policy "Owners upload property photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Owners delete property photos" on storage.objects;
create policy "Owners delete property photos" on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
