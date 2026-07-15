import { DEMO_ACTIVITIES, DEMO_EMAILS, DEMO_TICKETS } from './demo-data'
import type { AgentActivity, EmailThread, LLMSource, Ticket, TicketStatus } from '../types'

const SAMPLE_SESSION_KEY = 'findmnemo.sample.workspace.v2'

export interface SampleWorkspaceData {
  tickets: Ticket[]
  activities: AgentActivity[]
  emails: EmailThread[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function canonicalSampleData(): SampleWorkspaceData {
  return {
    tickets: clone(DEMO_TICKETS).map((ticket) => ({ ...ticket, origin: 'demo' as const })),
    activities: clone(DEMO_ACTIVITIES),
    emails: clone(DEMO_EMAILS),
  }
}

function isSampleData(value: unknown): value is SampleWorkspaceData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SampleWorkspaceData>
  return Array.isArray(candidate.tickets)
    && Array.isArray(candidate.activities)
    && Array.isArray(candidate.emails)
    && candidate.tickets.every((ticket) => ticket.origin === 'demo')
}

export function loadSampleWorkspace(): SampleWorkspaceData {
  try {
    const raw = sessionStorage.getItem(SAMPLE_SESSION_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isSampleData(parsed)) return parsed
    }
  } catch { /* restore the canonical sample below */ }
  return saveSampleWorkspace(canonicalSampleData())
}

export function saveSampleWorkspace(data: SampleWorkspaceData): SampleWorkspaceData {
  const safe = clone(data)
  try {
    sessionStorage.setItem(SAMPLE_SESSION_KEY, JSON.stringify(safe))
  } catch { /* session persistence is best-effort */ }
  return safe
}

export function resetSampleWorkspace(): SampleWorkspaceData {
  try {
    sessionStorage.removeItem(SAMPLE_SESSION_KEY)
  } catch { /* ignore */ }
  return saveSampleWorkspace(canonicalSampleData())
}

export function createSampleTicket(
  data: SampleWorkspaceData,
  title: string,
  description: string,
  source: LLMSource,
): SampleWorkspaceData {
  const now = new Date().toISOString()
  const ticket: Ticket = {
    id: `sample-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    title,
    description,
    source,
    origin: 'demo',
    status: 'todo',
    workNotes: [],
    artifacts: [],
    decisionLog: [],
    createdAt: now,
    updatedAt: now,
  }
  return saveSampleWorkspace({ ...data, tickets: [...data.tickets, ticket] })
}

export function updateSampleTicketStatus(
  data: SampleWorkspaceData,
  id: string,
  status: TicketStatus,
): SampleWorkspaceData {
  const updatedAt = new Date().toISOString()
  return saveSampleWorkspace({
    ...data,
    tickets: data.tickets.map((ticket) => {
      if (ticket.id !== id) return ticket
      const completedAt = status === 'done'
        ? ticket.status === 'done' && ticket.completedAt ? ticket.completedAt : updatedAt
        : null
      return { ...ticket, status, updatedAt, completedAt }
    }),
  })
}

export function addSampleWorkNote(
  data: SampleWorkspaceData,
  id: string,
  text: string,
): SampleWorkspaceData {
  const createdAt = new Date().toISOString()
  return saveSampleWorkspace({
    ...data,
    tickets: data.tickets.map((ticket) => ticket.id === id ? {
      ...ticket,
      updatedAt: createdAt,
      workNotes: [...ticket.workNotes, { id: `sample-note-${Date.now()}`, text, createdAt }],
    } : ticket),
  })
}

export function deleteSampleTicket(data: SampleWorkspaceData, id: string): SampleWorkspaceData {
  return saveSampleWorkspace({ ...data, tickets: data.tickets.filter((ticket) => ticket.id !== id) })
}

export function getSampleSessionKey(): string {
  return SAMPLE_SESSION_KEY
}
