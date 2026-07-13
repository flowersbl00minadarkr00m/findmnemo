import type { FindMnemoLifecycleBridge } from '../../shared/lifecycle-contract'

declare global {
  interface Window { findMnemoLifecycle: FindMnemoLifecycleBridge }
}

export {}
