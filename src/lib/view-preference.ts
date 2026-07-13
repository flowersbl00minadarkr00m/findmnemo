import type { HomeView } from '../types'

export const HOME_VIEW_PREFERENCE_KEY = 'findmnemo.presentation.home-view.v1'

export interface HomeViewPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function isHomeView(value: unknown): value is HomeView {
  return value === 'operations' || value === 'brief'
}

export function loadHomeViewPreference(storage?: Pick<HomeViewPreferenceStorage, 'getItem'>): HomeView {
  if (!storage) return 'operations'
  try {
    const value = storage.getItem(HOME_VIEW_PREFERENCE_KEY)
    return isHomeView(value) ? value : 'operations'
  } catch {
    return 'operations'
  }
}

export function saveHomeViewPreference(
  storage: Pick<HomeViewPreferenceStorage, 'setItem'> | undefined,
  view: HomeView,
): boolean {
  if (!storage || !isHomeView(view)) return false
  try {
    storage.setItem(HOME_VIEW_PREFERENCE_KEY, view)
    return true
  } catch {
    return false
  }
}
