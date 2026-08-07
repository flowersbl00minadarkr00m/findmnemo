import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  beginDesktopPackageRun,
  completeDesktopPackageRun,
  consumeDesktopPackageReceipt,
  finalizeConsumedDesktopPackageReceipt,
} from './desktop-package-receipt.mjs'

test('a fresh package receipt is hash-bound and consumable exactly once', async () => {
  const releaseRoot = await mkdtemp(join(tmpdir(), 'findmnemo-package-receipt-'))
  try {
    const started = await beginDesktopPackageRun({ releaseRoot })
    const packageRoot = join(releaseRoot, 'win-unpacked')
    await mkdir(join(packageRoot, 'resources'), { recursive: true })
    await writeFile(join(packageRoot, 'FindMnemo Companion.exe'), Buffer.alloc(2048, 0x45))
    await writeFile(join(packageRoot, 'resources', 'app.asar'), Buffer.alloc(4096, 0x41))

    const completed = await completeDesktopPackageRun({ releaseRoot })
    assert.equal(completed.runId, started.runId)

    const consumed = await consumeDesktopPackageReceipt({ releaseRoot })
    assert.equal(consumed.evidence.runId, started.runId)
    assert.equal(consumed.evidence.artifacts.executable.bytes, 2048)
    assert.equal(consumed.evidence.artifacts.asar.bytes, 4096)
    await finalizeConsumedDesktopPackageReceipt(consumed)

    await assert.rejects(
      consumeDesktopPackageReceipt({ releaseRoot }),
      /DESKTOP_PACKAGE_RECEIPT_MISSING/,
    )
  } finally {
    await rm(releaseRoot, { recursive: true, force: true })
  }
})

test('artifact drift invalidates the receipt and cannot be retried without packaging again', async () => {
  const releaseRoot = await mkdtemp(join(tmpdir(), 'findmnemo-package-drift-'))
  try {
    await beginDesktopPackageRun({ releaseRoot })
    const packageRoot = join(releaseRoot, 'win-unpacked')
    await mkdir(join(packageRoot, 'resources'), { recursive: true })
    const executable = join(packageRoot, 'FindMnemo Companion.exe')
    await writeFile(executable, Buffer.alloc(2048, 0x45))
    await writeFile(join(packageRoot, 'resources', 'app.asar'), Buffer.alloc(4096, 0x41))
    await completeDesktopPackageRun({ releaseRoot })
    await writeFile(executable, Buffer.alloc(2048, 0x46))

    await assert.rejects(
      consumeDesktopPackageReceipt({ releaseRoot }),
      /DESKTOP_PACKAGE_RECEIPT_ARTIFACT_MISMATCH/,
    )
    await assert.rejects(
      consumeDesktopPackageReceipt({ releaseRoot }),
      /DESKTOP_PACKAGE_RECEIPT_MISSING/,
    )
  } finally {
    await rm(releaseRoot, { recursive: true, force: true })
  }
})
