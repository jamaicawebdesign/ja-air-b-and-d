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
