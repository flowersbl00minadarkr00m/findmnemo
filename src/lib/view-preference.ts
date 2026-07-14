import type { HomeView, MetricsView } from '../types'

export const HOME_VIEW_PREFERENCE_KEY = 'findmnemo.presentation.home-view.v1'
export const METRICS_VIEW_PREFERENCE_KEY = 'findmnemo.presentation.metrics-view.v1'

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

export function isMetricsView(value: unknown): value is MetricsView {
  return value === 'usage' || value === 'analytics'
}

export function loadMetricsViewPreference(storage?: Pick<HomeViewPreferenceStorage, 'getItem'>): MetricsView {
  if (!storage) return 'usage'
  try {
    const value = storage.getItem(METRICS_VIEW_PREFERENCE_KEY)
    return isMetricsView(value) ? value : 'usage'
  } catch {
    return 'usage'
  }
}

export function saveMetricsViewPreference(storage: Pick<HomeViewPreferenceStorage, 'setItem'> | undefined, view: MetricsView): boolean {
  if (!storage || !isMetricsView(view)) return false
  try {
    storage.setItem(METRICS_VIEW_PREFERENCE_KEY, view)
    return true
  } catch {
    return false
  }
}
