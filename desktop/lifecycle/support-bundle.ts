import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { LifecycleDiagnosticReport, SupportBundlePreview, SupportSaveResult } from '../../shared/lifecycle-contract.js'

const PROHIBITED_KEY = /(token|secret|password|credential(value)?|authorization|cookie|session|email|prompt|response|body|command(line)?|environment|raw(log)?|path)/i
const PROHIBITED_VALUE = /(bearer\s+[a-z0-9._-]+|ya29\.|sk-[a-z0-9]|refresh[_-]?token|authorization:|cookie:)/i

export class SupportBundleService {
  #previews = new Map<string, { expiresAt: number; preview: SupportBundlePreview }>()
  constructor(readonly clock: () => Date = () => new Date()) {}

  preview(report: LifecycleDiagnosticReport): SupportBundlePreview {
    assertSafe(report)
    const preview: SupportBundlePreview = {
      previewId: randomUUID(), generatedAt: this.clock().toISOString(),
      fields: ['generatedAt', 'checks[].id', 'checks[].state', 'checks[].code', 'checks[].boundary', 'checks[].message', 'checks[].retryable', 'checks[].recoveryAction'],
      report,
    }
    this.#previews.set(preview.previewId, { expiresAt: this.clock().getTime() + 10 * 60_000, preview })
    return structuredClone(preview)
  }

  async save(previewId: string, path: string): Promise<SupportSaveResult> {
    const stored = this.#previews.get(previewId)
    this.#previews.delete(previewId)
    if (!stored || stored.expiresAt < this.clock().getTime()) return { ok: false, errorCode: 'SUPPORT_PREVIEW_EXPIRED' }
    assertSafe(stored.preview.report)
    await writeFile(path, `${JSON.stringify({ profile: 'findmnemo.support.v1', ...stored.preview.report }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    return { ok: true, fileName: basename(path) }
  }
}

export function assertSafe(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    if (PROHIBITED_VALUE.test(value)) throw Object.assign(new Error(`Support content is prohibited at ${path}.`), { code: 'SUPPORT_CONTENT_PROHIBITED' })
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (PROHIBITED_KEY.test(key)) throw Object.assign(new Error(`Support field is prohibited at ${childPath}.`), { code: 'SUPPORT_FIELD_PROHIBITED' })
    assertSafe(child, childPath)
  }
}
