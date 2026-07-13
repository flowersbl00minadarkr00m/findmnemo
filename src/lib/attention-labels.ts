import type { AttentionTruthState } from '../types'

export function attentionStateLabel(state: AttentionTruthState): string {
  return state.replace('-', ' ')
}
