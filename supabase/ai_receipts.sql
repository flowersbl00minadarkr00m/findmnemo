create table if not exists public.ai_receipts (
  id text primary key,
  ticket_id text,
  project_progress_id text,
  agent_source text not null,
  model_or_surface text,
  request text not null,
  summary text not null,
  actions_taken jsonb not null default '[]'::jsonb,
  artifact_refs jsonb not null default '[]'::jsonb,
  verification jsonb not null default '[]'::jsonb,
  facts jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  outcome text not null,
  human_disposition text,
  telemetry_event_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint ai_receipts_target_check check (
    ticket_id is not null or project_progress_id is not null
  ),
  constraint ai_receipts_outcome_check check (
    outcome in ('proposed', 'verified', 'accepted', 'rejected', 'superseded')
  ),
  constraint ai_receipts_human_disposition_check check (
    human_disposition is null or human_disposition in ('accepted', 'rejected', 'needs-follow-up')
  )
);

alter table public.ai_receipts enable row level security;

grant select on public.ai_receipts to anon, authenticated;
revoke update on public.ai_receipts from anon, authenticated;
grant update (human_disposition) on public.ai_receipts to anon, authenticated;

drop policy if exists "AI receipts are readable by browser clients" on public.ai_receipts;

create policy "AI receipts are readable by browser clients"
on public.ai_receipts
for select
to anon, authenticated
using (true);

drop policy if exists "AI receipt human disposition is writable by browser clients" on public.ai_receipts;

create policy "AI receipt human disposition is writable by browser clients"
on public.ai_receipts
for update
to anon, authenticated
using (true)
with check (true);
