-- Migration date: 2026-05-11

-- Store landing-page contact form submissions.
-- The landing server route writes with the Supabase service role; browser
-- anon/authenticated roles should not have direct table access.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  subject text,
  message text not null,
  source text not null default 'landing',
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists idx_contact_messages_created_at
  on public.contact_messages(created_at desc);

alter table public.contact_messages enable row level security;

revoke all privileges on table public.contact_messages
  from anon, authenticated;
