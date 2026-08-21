-- Durable, Postgres-backed background jobs (the "DB queue").
--
-- WHY A SECOND QUEUE MECHANISM: the BullMQ queues (conversion/extraction) are
-- opt-in because they require Redis, which the default deployment does not
-- run. But some workloads must be durable in EVERY deployment — audit trails,
-- account deletion, export generation — and every deployment already has
-- Postgres. This table + claim function give those workloads at-least-once
-- execution with retries and crash recovery using nothing but the database
-- that is already there, so the DB queue can run BY DEFAULT with zero new
-- infrastructure (web, Word add-in, and Mac app stacks alike).
--
-- Concurrency model: workers claim batches via FOR UPDATE SKIP LOCKED, the
-- standard Postgres idiom for job queues — concurrent claimers never block
-- each other and never double-claim a row. Durable state machine per job:
--   pending --claim--> running --ok--> done
--                       |  \--error--> pending (run_at pushed back; retry)
--                       \--attempts exhausted--> failed (terminal, kept for
--                                                inspection)
-- Crash recovery: a worker that dies mid-job leaves it "running"; the claim
-- function re-claims running jobs whose claimed_at is older than the stale
-- threshold, so orphaned work resumes without any external supervisor.

create table if not exists public.db_jobs (
  id uuid primary key default gen_random_uuid(),
  -- Handler selector, e.g. 'audit.chat_turn', 'account.delete',
  -- 'storage.cleanup', 'export.build'. Unknown kinds are failed permanently
  -- by the runner rather than retried forever.
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  -- Incremented at claim time (not completion), so a crash mid-run still
  -- counts the attempt and cannot produce an infinite crash loop.
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts >= 1),
  -- Earliest time the job may (re)run; retries push this into the future
  -- with exponential backoff.
  run_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  last_error text,
  -- Optional application-level dedupe (see partial unique index below): a
  -- second enqueue of the same key while one is pending/running is rejected
  -- by the index, and the caller treats unique-violation as "already queued".
  dedupe_key text,
  -- Handler-written result consumed by pollers (e.g. an export's storage
  -- path + filename once built).
  result jsonb,
  created_at timestamptz not null default now()
);

-- The claim scan: pending-and-due ordered by run_at. Partial index keeps it
-- tiny no matter how much done/failed history is retained.
create index if not exists db_jobs_claim_idx
  on public.db_jobs (run_at)
  where status = 'pending';

-- Stale-running recovery scan.
create index if not exists db_jobs_running_idx
  on public.db_jobs (claimed_at)
  where status = 'running';

-- Dedupe only among live jobs: once a job is done/failed the key is free to
-- be enqueued again (e.g. a second export of the same type tomorrow).
create unique index if not exists db_jobs_dedupe_live_idx
  on public.db_jobs (dedupe_key)
  where dedupe_key is not null and status in ('pending', 'running');

-- Retention sweep support (delete done/failed rows past their keep window).
create index if not exists db_jobs_finished_idx
  on public.db_jobs (finished_at)
  where status in ('done', 'failed');

alter table public.db_jobs enable row level security;
revoke all on public.db_jobs from anon, authenticated;
grant select, insert, update, delete on public.db_jobs to service_role;

-- Atomically claim up to p_limit runnable jobs. Returns the claimed rows.
--
-- "Runnable" is EITHER a due pending job OR a running job whose claim went
-- stale (worker crashed / was SIGKILLed mid-run) — folding crash recovery
-- into the claim itself means there is no separate reaper to keep in sync.
-- FOR UPDATE SKIP LOCKED makes concurrent claimers (multiple backend
-- replicas, or overlapping poll ticks) partition the work instead of racing:
-- locked rows are skipped, never waited on and never double-claimed.
create or replace function public.claim_db_jobs(
  p_limit integer default 5,
  p_stale_seconds integer default 600
)
returns setof public.db_jobs
language sql
as $$
  with candidates as (
    select id
      from public.db_jobs
     where (status = 'pending' and run_at <= now())
        or (status = 'running'
            and claimed_at < now() - make_interval(secs => p_stale_seconds))
     order by run_at
     limit p_limit
       for update skip locked
  )
  update public.db_jobs j
     set status = 'running',
         claimed_at = now(),
         attempts = j.attempts + 1
    from candidates c
   where j.id = c.id
  returning j.*;
$$;

revoke execute on function public.claim_db_jobs(integer, integer)
  from anon, authenticated, public;
grant execute on function public.claim_db_jobs(integer, integer)
  to service_role;

-- Claim ONE job by id — the Redis-delivery path (transactional-outbox
-- pattern). When Redis is configured, enqueue also adds a BullMQ "delivery"
-- job carrying this row's id so pickup is instant; the worker still claims
-- through Postgres via this function, so a duplicate delivery (BullMQ retry,
-- poller backstop racing the delivery) can never double-run the job: the
-- second claimer matches zero rows. Same stale-running recovery as the batch
-- claim.
create or replace function public.claim_db_job(
  p_id uuid,
  p_stale_seconds integer default 600
)
returns setof public.db_jobs
language sql
as $$
  update public.db_jobs j
     set status = 'running',
         claimed_at = now(),
         attempts = j.attempts + 1
   where j.id = p_id
     and ((j.status = 'pending' and j.run_at <= now())
       or (j.status = 'running'
           and j.claimed_at < now() - make_interval(secs => p_stale_seconds)))
  returning j.*;
$$;

revoke execute on function public.claim_db_job(uuid, integer)
  from anon, authenticated, public;
grant execute on function public.claim_db_job(uuid, integer)
  to service_role;

-- Cancellation for dedupe-keyed jobs (clear-cells in Postgres-driver mode):
-- pending jobs are deleted outright; running jobs get a persisted
-- `canceled: true` stamped into their payload, which handlers check on each
-- (re)claim — mirroring the BullMQ Job#updateData cancellation path.
create or replace function public.cancel_db_jobs(p_dedupe_keys text[])
returns integer
language sql
as $$
  with deleted as (
    delete from public.db_jobs
     where dedupe_key = any(p_dedupe_keys)
       and status = 'pending'
    returning 1
  ), marked as (
    update public.db_jobs
       set payload = payload || jsonb_build_object('canceled', true)
     where dedupe_key = any(p_dedupe_keys)
       and status = 'running'
    returning 1
  )
  select coalesce((select count(*) from deleted), 0)::integer
       + coalesce((select count(*) from marked), 0)::integer;
$$;

revoke execute on function public.cancel_db_jobs(text[])
  from anon, authenticated, public;
grant execute on function public.cancel_db_jobs(text[])
  to service_role;
