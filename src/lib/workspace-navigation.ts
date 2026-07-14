import type { PrimaryArea, View } from '../types'
import { loadHomeViewPreference, loadMetricsViewPreference, type HomeViewPreferenceStorage } from './view-preference'

export interface PrimaryAreaDefinition {
  id: PrimaryArea
  marker: 'M' | 'N' | 'E' | 'O'
  label: string
  description: string
  leaves: View[]
  keywords: string[]
}

export const PRIMARY_AREAS: PrimaryAreaDefinition[] = [
  { id: 'my-day', marker: 'M', label: 'My Day', description: 'What needs your attention today', leaves: ['operations', 'brief'], keywords: ['operations desk', 'daily brief', 'dashboard', 'home'] },
  { id: 'next-actions', marker: 'N', label: 'Next Actions', description: 'Tickets and generated project work', leaves: ['tickets'], keywords: ['tickets', 'tasks', 'projects', 'sdd', 'projects/sdd'] },
  { id: 'engines', marker: 'E', label: 'Engines', description: 'AI connections and routing preferences', leaves: ['routing'], keywords: ['model routing', 'providers', 'models', 'routes'] },
  { id: 'metrics', marker: 'M', label: 'Metrics', description: 'Model usage and work evidence', leaves: ['usage', 'analytics'], keywords: ['model usage', 'analytics', 'work metrics', 'tokens', 'cost'] },
  { id: 'outreach', marker: 'O', label: 'Outreach', description: 'Email responses and linked work', leaves: ['emails'], keywords: ['emails', 'gmail', 'inbox'] },
]

export const VIEW_META: Record<View, { title: string; subtitle: string }> = {
  operations: { title: 'My Day', subtitle: 'Prioritized work, evidence, and source health' },
  brief: { title: 'My Day', subtitle: 'A simplified brief over the same operational records' },
  tickets: { title: 'Next Actions', subtitle: 'Tickets, generated project work, and their evidence' },
  routing: { title: 'Engines', subtitle: 'AI connections, readiness, and route preferences' },
  usage: { title: 'Metrics', subtitle: 'Observed model usage and source coverage' },
  analytics: { title: 'Metrics', subtitle: 'Ticket throughput, decisions, and cycle time' },
  emails: { title: 'Outreach', subtitle: 'Email threads that may need your response' },
  settings: { title: 'Data & Privacy', subtitle: 'Download, restore, compatibility, and local data controls' },
}

export function primaryAreaForView(view: View): PrimaryArea | null {
  return PRIMARY_AREAS.find((area) => area.leaves.includes(view))?.id ?? null
}

export function resolvePrimaryArea(area: PrimaryArea, storage?: Pick<HomeViewPreferenceStorage, 'getItem'>): View {
  if (area === 'my-day') return loadHomeViewPreference(storage)
  if (area === 'metrics') return loadMetricsViewPreference(storage)
  return { 'next-actions': 'tickets', engines: 'routing', outreach: 'emails' }[area] as View
}

export function normalizeLegacyView(value: unknown, storage?: Pick<HomeViewPreferenceStorage, 'getItem'>): View {
  if (typeof value !== 'string') return resolvePrimaryArea('my-day', storage)
  const normalized = value.trim().toLowerCase()
  if (normalized === 'operations' || normalized === 'dashboard' || normalized === 'my day') return resolvePrimaryArea('my-day', storage)
  if (normalized === 'brief' || normalized === 'daily brief') return 'brief'
  if (['tickets', 'sdd', 'projects', 'projects/sdd', 'next actions'].includes(normalized)) return 'tickets'
  if (['routing', 'model routing', 'engines'].includes(normalized)) return 'routing'
  if (['usage', 'model usage'].includes(normalized)) return 'usage'
  if (['analytics', 'work metrics', 'metrics'].includes(normalized)) return normalized === 'metrics' ? resolvePrimaryArea('metrics', storage) : 'analytics'
  if (['emails', 'gmail', 'outreach'].includes(normalized)) return 'emails'
  if (['settings', 'data & privacy', 'data and privacy'].includes(normalized)) return 'settings'
  return resolvePrimaryArea('my-day', storage)
}
