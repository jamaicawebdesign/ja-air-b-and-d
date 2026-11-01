-- Subscriptions: which customer is on which plan (you manage status/paid_until from the Table Editor)
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'host' check (plan in ('starter','host','pro','manager')),
  status text not null default 'pending' check (status in ('pending','trial','active','expired')),
  trial_ends date,
  paid_until date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "Users read own subscription" on public.subscriptions;
create policy "Users read own subscription" on public.subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
-- No insert/update/delete policies: customers cannot change their own plan or status.

-- New signups get a pending row automatically
create or replace function public.handle_new_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id, email, status, trial_ends)
  values (new.id, new.email, 'pending', current_date + 14)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_subscription on auth.users;
create trigger on_auth_user_created_subscription after insert on auth.users
  for each row execute function public.handle_new_subscription();

-- Existing accounts are grandfathered as active (top plan, no expiry) so nobody is locked out
insert into public.subscriptions (user_id, email, plan, status)
select id, email, 'manager', 'active' from auth.users
on conflict (user_id) do nothing;

-- Lets a customer record which plan they chose (only while pending/trial; never touches status)
create or replace function public.choose_plan(p_plan text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_plan not in ('starter','host','pro','manager') then raise exception 'Unknown plan'; end if;
  update public.subscriptions set plan = p_plan, updated_at = now()
  where user_id = (select auth.uid()) and status in ('pending','trial');
end $$;
revoke all on function public.choose_plan(text) from public, anon;
grant execute on function public.choose_plan(text) to authenticated;

-- Server-side limits: block adding properties beyond the plan, or when the subscription has expired
create or replace function public.enforce_property_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.subscriptions; lim int; cnt int;
begin
  select * into s from public.subscriptions where user_id = new.user_id;
  if not found then return new; end if;
  if s.status = 'expired' or (s.status = 'active' and s.paid_until is not null and s.paid_until < current_date) then
    raise exception 'Your subscription has expired. Please renew to add properties.';
  end if;
  lim := case s.plan when 'starter' then 2 when 'host' then 6 when 'pro' then 15 else 40 end;
  select count(*) into cnt from public.properties where user_id = new.user_id;
  if cnt >= lim then
    raise exception 'Your % plan allows % properties. Upgrade to add more.', s.plan, lim;
  end if;
  return new;
end $$;
drop trigger if exists property_limit on public.properties;
create trigger property_limit before insert on public.properties
  for each row execute function public.enforce_property_limit();
