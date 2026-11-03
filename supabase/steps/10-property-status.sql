-- Property status: active, inactive, maintenance or archived. Safe to run more than once.
alter table public.properties add column if not exists status text not null default 'active'
  check (status in ('active', 'inactive', 'maintenance', 'archived'));

-- A property that isn't active is never shown on the public booking website
create or replace function public.unlist_inactive_property() returns trigger
language plpgsql as $$
begin
  if new.status <> 'active' then new.listed := false; end if;
  return new;
end $$;
drop trigger if exists unlist_inactive on public.properties;
create trigger unlist_inactive before insert or update on public.properties
  for each row execute function public.unlist_inactive_property();
update public.properties set listed = false where status <> 'active' and listed;
