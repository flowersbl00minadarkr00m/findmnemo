import type {
  LLMSource,
  TelemetryActivityType,
  Ticket,
  WorkTelemetryCollection,
  WorkTelemetryEvent,
} from '../types'

const TELEMETRY_KEY = 'mnemosync_work_events_v1'

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function actor(source: LLMSource | 'Henry' | 'FindMnemo') {
  if (source === 'Henry') {
    return {
      id: 'human-henry',
      label: 'Henry',
      type: 'human' as const,
      role: 'workspace owner',
      authorityLevel: 7,
    }
  }
  if (source === 'FindMnemo') {
    return {
      id: 'system-mnemosync',
      label: 'FindMnemo',
      type: 'system' as const,
      role: 'work telemetry producer',
      authorityLevel: 2,
    }
  }
  return {
    id: `agent-${source.toLowerCase().replace(/\s+/g, '-')}`,
    label: source,
    type: 'agent' as const,
    role: 'AI work agent',
    authorityLevel: 3,
  }
}

export function loadTelemetry(): WorkTelemetryEvent[] {
  try {
    const raw = localStorage.getItem(TELEMETRY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as WorkTelemetryEvent[] : []
  } catch {
    return []
  }
}

export function appendTelemetry(event: WorkTelemetryEvent): WorkTelemetryEvent {
  const events = loadTelemetry()
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify([...events, event]))
  window.dispatchEvent(new Event('mnemosync-telemetry'))
  return event
}

export function recordTelemetry(input: {
  ticket: Ticket
  activityId: string
  label: string
  type: TelemetryActivityType
  actor: LLMSource | 'Henry' | 'FindMnemo'
  timestamp?: string
  transition?: { fromState?: string; toState?: string }
  result?: WorkTelemetryEvent['result']
  decision?: WorkTelemetryEvent['decision']
  evidence?: WorkTelemetryEvent['evidence']
  acceptedOutcome?: boolean
  tags?: string[]
}): WorkTelemetryEvent {
  const events = loadTelemetry()
  const timestamp = input.timestamp ?? new Date().toISOString()
  const event: WorkTelemetryEvent = {
    eventId: `mnemo-${generateId()}`,
    caseId: input.ticket.id,
    traceId: `ticket-${input.ticket.id}`,
    timestamp,
    sequence: events.filter((candidate) => candidate.caseId === input.ticket.id).length,
    intent: input.ticket.title,
    activity: {
      id: input.activityId,
      label: input.label,
      type: input.type,
      primitiveVersion: '1.0.0',
    },
    ...(input.transition ? { transition: input.transition } : {}),
    actor: actor(input.actor),
    objects: [{
      id: input.ticket.id,
      type: 'mnemosync-ticket',
      role: 'subject',
      sourceRef: `mnemosync://ticket/${input.ticket.id}`,
      classification: 'private-work-data',
    }],
    ...(input.decision ? { decision: input.decision } : {}),
    result: input.result ?? { status: 'success' },
    ...(input.evidence?.length ? { evidence: input.evidence } : {}),
    ...(input.acceptedOutcome !== undefined ? { acceptedOutcome: input.acceptedOutcome } : {}),
    truthState: 'observed',
    provenance: {
      sourceType: 'mnemosync',
      sourceRef: `mnemosync://ticket/${input.ticket.id}`,
      ingestedAt: timestamp,
      transformation: 'FindMnemo local activity ledger v1',
    },
    tags: [...new Set(['mnemosync', ...(input.tags ?? [])])],
  }
  return appendTelemetry(event)
}

export function exportTelemetry(): WorkTelemetryCollection {
  return {
    schemaVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    events: loadTelemetry(),
  }
}

export function downloadTelemetry(): boolean {
  const collection = exportTelemetry()
  if (collection.events.length === 0) return false
  const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `mnemosync-work-events-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
  return true
}

export function importTelemetryJSONL(jsonlContent: string): { imported: number; skipped: number; errors: string[] } {
  const existing = loadTelemetry()
  const existingIds = new Set(existing.map((e) => e.eventId))
  const errors: string[] = []
  let imported = 0
  let skipped = 0

  const lines = jsonlContent.split('\n').filter((line) => line.trim().length > 0)

  for (let i = 0; i < lines.length; i++) {
    try {
      const event: WorkTelemetryEvent = JSON.parse(lines[i])
      if (!event.eventId || !event.caseId || !event.timestamp || !event.activity) {
        errors.push(`Line ${i + 1}: missing required fields (eventId, caseId, timestamp, activity)`)
        skipped++
        continue
      }
      if (existingIds.has(event.eventId)) {
        skipped++
        continue
      }
      // Ensure provenance if missing
      if (!event.provenance) {
        event.provenance = {
          sourceType: 'mnemosync',
          sourceRef: `mnemosync://ticket/${event.caseId}`,
          ingestedAt: event.timestamp,
          transformation: 'JSONL import',
        }
      }
      if (!event.result) {
        event.result = { status: 'success' }
      }
      if (!event.truthState) {
        event.truthState = 'observed'
      }
      if (!event.tags) {
        event.tags = ['mnemosync', 'imported']
      } else if (!event.tags.includes('imported')) {
        event.tags.push('imported')
      }
      existing.push(event)
      existingIds.add(event.eventId)
      imported++
    } catch (e) {
      errors.push(`Line ${i + 1}: invalid JSON — ${(e as Error).message}`)
      skipped++
    }
  }

  if (imported > 0) {
    localStorage.setItem(TELEMETRY_KEY, JSON.stringify(existing))
    window.dispatchEvent(new Event('mnemosync-telemetry'))
  }

  return { imported, skipped, errors }
}

export function clearTelemetry(): void {
  localStorage.removeItem(TELEMETRY_KEY)
  window.dispatchEvent(new Event('mnemosync-telemetry'))
}
