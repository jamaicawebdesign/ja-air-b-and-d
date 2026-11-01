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
