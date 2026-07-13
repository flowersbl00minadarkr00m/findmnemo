create table if not exists public.project_progress_items (
  id text primary key,
  project_id text not null,
  project_name text not null,
  spec_id text,
  spec_title text,
  current_gate text not null,
  next_safe_action text not null,
  artifact_refs jsonb not null default '[]'::jsonb,
  canonical_path text,
  path_visibility text not null default 'hidden',
  origin text not null default 'registry-sync',
  last_scanned_at timestamptz not null,
  issues jsonb not null default '[]'::jsonb,
  constraint project_progress_items_gate_check check (
    current_gate in (
      'uninitialized',
      'requirements:draft',
      'requirements:approved',
      'design:draft',
      'design:approved',
      'tasks:draft',
      'tasks:approved',
      'implementation:in-progress',
      'implementation:done',
      'review:done',
      'invalid-status',
      'stale-path'
    )
  ),
  constraint project_progress_items_path_visibility_check check (
    path_visibility in ('hidden', 'local-only', 'visible')
  ),
  constraint project_progress_items_hidden_path_check check (
    path_visibility <> 'hidden' or canonical_path is null
  ),
  constraint project_progress_items_origin_check check (origin = 'registry-sync')
);

alter table public.project_progress_items enable row level security;

grant select on public.project_progress_items to anon, authenticated;

drop policy if exists "Project progress is readable by browser clients" on public.project_progress_items;

create policy "Project progress is readable by browser clients"
on public.project_progress_items
for select
to anon, authenticated
using (true);
