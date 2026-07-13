import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LifecycleDiagnosticReport } from '../../shared/lifecycle-contract.js'
import { assertSafe, SupportBundleService } from './support-bundle.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const report: LifecycleDiagnosticReport = { generatedAt: '2026-07-12T00:00:00.000Z', checks: [{ id: 'listener', state: 'pass', code: 'IDENTITY_VERIFIED', boundary: 'listener', message: 'Compatible loopback identity verified.', retryable: false }] }

describe('SupportBundleService', () => {
  it('writes only a previously previewed allowlisted report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-support-')); roots.push(root)
    const service = new SupportBundleService(() => new Date('2026-07-12T00:00:00.000Z'))
    const preview = service.preview(report)
    const path = join(root, 'support.json')
    expect(await service.save(preview.previewId, path)).toMatchObject({ ok: true, fileName: 'support.json' })
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ profile: 'findmnemo.support.v1', checks: report.checks })
    expect(await service.save(preview.previewId, path)).toMatchObject({ ok: false })
  })

  it.each([
    [{ credentialValue: 'encrypted' }, 'SUPPORT_FIELD_PROHIBITED'],
    [{ nested: { prompt: 'private' } }, 'SUPPORT_FIELD_PROHIBITED'],
    [{ detail: 'Bearer abc.def.ghi' }, 'SUPPORT_CONTENT_PROHIBITED'],
    [{ localPath: 'C:\\Users\\person' }, 'SUPPORT_FIELD_PROHIBITED'],
  ])('rejects prohibited nested evidence', (value, code) => {
    expect(() => assertSafe(value)).toThrow(expect.objectContaining({ code }))
  })
})
