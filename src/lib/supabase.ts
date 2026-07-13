import { createClient } from '@supabase/supabase-js'
import type { HumanReceiptDisposition, ProjectProgressItem, SddGate } from '../types'
import { isValidSddGate, normalizePathVisibility, normalizeProjectProgressItem } from './sdd-progress'

const SUPABASE_URL = 'https://snoouuphzmmbvtobxhaw.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_gxnw83ffk_c6evmAqS7FEg_8WhxdRXX'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

type ProjectProgressRow = {
  id: string
  project_id: string
  project_name: string
  spec_id: string | null
  spec_title: string | null
  current_gate: string
  next_safe_action: string | null
  artifact_refs: unknown
  canonical_path: string | null
  path_visibility: string | null
  last_scanned_at: string
  issues: unknown
}

function asProjectProgressItems(rows: ProjectProgressRow[]): ProjectProgressItem[] {
  return rows
    .filter((row) => isValidSddGate(row.current_gate))
    .map((row) => {
      const pathVisibility = normalizePathVisibility(row.path_visibility)
      return normalizeProjectProgressItem({
        id: row.id,
        projectId: row.project_id,
        projectName: row.project_name,
        specId: row.spec_id ?? undefined,
        specTitle: row.spec_title ?? undefined,
        currentGate: row.current_gate as SddGate,
        nextSafeAction: row.next_safe_action ?? undefined,
        artifactRefs: Array.isArray(row.artifact_refs) ? row.artifact_refs as ProjectProgressItem['artifactRefs'] : [],
        canonicalPath: row.canonical_path ?? undefined,
        pathVisibility,
        lastScannedAt: row.last_scanned_at,
        issues: Array.isArray(row.issues) ? row.issues as ProjectProgressItem['issues'] : [],
      })
    })
}

export async function loadProjectProgressItems(): Promise<{ items: ProjectProgressItem[]; error?: string }> {
  const { data, error } = await supabase
    .from('project_progress_items')
    .select('id, project_id, project_name, spec_id, spec_title, current_gate, next_safe_action, artifact_refs, canonical_path, path_visibility, last_scanned_at, issues')
    .order('last_scanned_at', { ascending: false })

  if (error) return { items: [], error: error.message }
  return { items: asProjectProgressItems((data ?? []) as ProjectProgressRow[]) }
}

export async function updateAiReceiptHumanDisposition(
  receiptId: string,
  disposition: HumanReceiptDisposition,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('ai_receipts')
    .update({ human_disposition: disposition })
    .eq('id', receiptId)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'No matching receipt row was updated.' }
  return { ok: true }
}
