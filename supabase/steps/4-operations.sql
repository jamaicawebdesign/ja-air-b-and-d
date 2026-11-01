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

-- Private storage for task photo proof; each owner can only touch their own folder
insert into storage.buckets (id, name, public) values ('task-photos', 'task-photos', false) on conflict (id) do nothing;
drop policy if exists "Owners read task photos" on storage.objects;
create policy "Owners read task photos" on storage.objects for select to authenticated
  using (bucket_id = 'task-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Owners upload task photos" on storage.objects;
create policy "Owners upload task photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Owners delete task photos" on storage.objects;
create policy "Owners delete task photos" on storage.objects for delete to authenticated
  using (bucket_id = 'task-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
