-- Apply once to an existing FindMnemo Supabase project.
-- This is intentionally non-destructive: it preserves every row while
-- removing browser-role access to operational tables.

begin;

alter table if exists public.telemetry_events enable row level security;
alter table if exists public.project_progress_items enable row level security;
alter table if exists public.ai_receipts enable row level security;

revoke all on table public.telemetry_events from anon, authenticated;
revoke all on table public.project_progress_items from anon, authenticated;
revoke all on table public.ai_receipts from anon, authenticated;

drop policy if exists "anon_can_read_telemetry" on public.telemetry_events;
drop policy if exists "Project progress is readable by browser clients" on public.project_progress_items;
drop policy if exists "AI receipts are readable by browser clients" on public.ai_receipts;
drop policy if exists "AI receipt human disposition is writable by browser clients" on public.ai_receipts;

commit;
