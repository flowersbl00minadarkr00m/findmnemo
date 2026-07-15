import type { CompletedRangePreset } from '../../shared/companion-contract'

const KEY = 'findmnemo.completed-work-view.v1'
interface Preference { version: 1; mode: 'active' | 'completed'; preset: CompletedRangePreset }

export function loadCompletedWorkPreference(storage: Pick<Storage, 'getItem'> | undefined): Preference {
  if (!storage) return { version: 1, mode: 'active', preset: '30d' }
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? '') as Partial<Preference>
    if (value.version === 1 && (value.mode === 'active' || value.mode === 'completed') && ['7d', '30d', '90d', '12mo'].includes(value.preset ?? '')) return value as Preference
  } catch { /* invalid preferences are not evidence */ }
  return { version: 1, mode: 'active', preset: '30d' }
}

export function saveCompletedWorkPreference(storage: Pick<Storage, 'setItem'> | undefined, value: Omit<Preference, 'version'>): void {
  try { storage?.setItem(KEY, JSON.stringify({ version: 1, ...value })) } catch { /* preference failure does not block work */ }
}
