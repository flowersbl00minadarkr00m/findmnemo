import type { WorkTelemetryEvent } from '../types'
import { loadTelemetry } from './telemetry'
import { supabase } from './supabase'

const TELEMETRY_KEY = 'mnemosync_work_events_v1'

export async function ingestSupabaseEvents(): Promise<{ imported: number }> {
  try {
    const { data, error } = await supabase
      .from('telemetry_events')
      .select('*')
      .order('timestamp', { ascending: true })
      .limit(1000)

    if (error) {
      console.warn('FindMnemo: Supabase fetch failed:', error.message)
      return { imported: 0 }
    }
    if (!data || data.length === 0) return { imported: 0 }

    const existing = loadTelemetry()
    const existingIds = new Set(existing.map((event) => event.eventId))
    let imported = 0

    for (const row of data) {
      if (existingIds.has(row.event_id)) continue
      const event: WorkTelemetryEvent = {
        eventId: row.event_id,
        caseId: row.case_id,
        traceId: row.trace_id,
        parentEventId: row.parent_event_id,
        timestamp: row.timestamp,
        sequence: row.sequence,
        intent: row.intent,
        activity: row.activity,
        transition: row.transition,
        actor: row.actor,
        objects: row.objects,
        decision: row.decision,
        result: row.result || { status: 'success' },
        evidence: row.evidence,
        acceptedOutcome: row.accepted_outcome,
        truthState: row.truth_state || 'observed',
        provenance: row.provenance || {
          sourceType: 'mnemosync',
          sourceRef: `mnemosync://ticket/${row.case_id}`,
          ingestedAt: row.timestamp,
          transformation: 'Supabase import',
        },
        tags: row.tags || ['mnemosync', 'imported'],
      }
      existing.push(event)
      existingIds.add(event.eventId)
      imported++
    }

    if (imported > 0) {
      localStorage.setItem(TELEMETRY_KEY, JSON.stringify(existing))
      window.dispatchEvent(new Event('mnemosync-telemetry'))
    }

    return { imported }
  } catch (err) {
    console.warn('FindMnemo: Supabase ingest failed:', err)
    return { imported: 0 }
  }
}

export function subscribeToSupabaseRealtime(
  onEvent: (event: WorkTelemetryEvent) => void,
): () => void {
  const channel = supabase
    .channel('telemetry-events')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'telemetry_events' },
      (payload) => {
        const row = payload.new as Record<string, unknown>
        const event: WorkTelemetryEvent = {
          eventId: row.event_id as string,
          caseId: row.case_id as string,
          traceId: row.trace_id as string,
          parentEventId: row.parent_event_id as string | undefined,
          timestamp: row.timestamp as string,
          sequence: (row.sequence as number) || 0,
          intent: row.intent as string | undefined,
          activity: row.activity as WorkTelemetryEvent['activity'],
          transition: row.transition as WorkTelemetryEvent['transition'],
          actor: row.actor as WorkTelemetryEvent['actor'],
          objects: row.objects as WorkTelemetryEvent['objects'],
          decision: row.decision as WorkTelemetryEvent['decision'],
          result: (row.result as WorkTelemetryEvent['result']) || { status: 'success' },
          evidence: row.evidence as WorkTelemetryEvent['evidence'],
          acceptedOutcome: row.accepted_outcome as boolean | undefined,
          truthState: (row.truth_state as WorkTelemetryEvent['truthState']) || 'observed',
          provenance: (row.provenance as WorkTelemetryEvent['provenance']) || {
            sourceType: 'mnemosync',
            sourceRef: `mnemosync://ticket/${row.case_id}`,
            ingestedAt: row.timestamp as string,
            transformation: 'Supabase realtime',
          },
          tags: (row.tags as string[]) || ['mnemosync', 'realtime'],
        }
        onEvent(event)
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
