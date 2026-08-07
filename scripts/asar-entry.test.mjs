import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackage, extractFile, listPackage } from '@electron/asar'
import { indexAsarEntries } from './asar-entry.mjs'

test('normalizes Windows ASAR names without changing the raw extraction path', () => {
  const rawEntry = String.raw`\dist-desktop\desktop\main.js`
  const entries = indexAsarEntries([rawEntry])

  assert.deepEqual(entries.normalizedNames, ['/dist-desktop/desktop/main.js'])
  assert.equal(entries.byNormalizedName.get('/dist-desktop/desktop/main.js')?.rawName, rawEntry)
  assert.equal(
    entries.byNormalizedName.get('/dist-desktop/desktop/main.js')?.extractionPath,
    String.raw`dist-desktop\desktop\main.js`,
  )
})

test('extracts a Windows ASAR file with the exact raw separators returned by listPackage', {
  skip: process.platform !== 'win32',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-asar-entry-'))
  try {
    const sourceRoot = join(root, 'source')
    const sourceFile = join(sourceRoot, 'dist-desktop', 'desktop', 'main.js')
    const archive = join(root, 'test.asar')
    await mkdir(join(sourceRoot, 'dist-desktop', 'desktop'), { recursive: true })
    await writeFile(sourceFile, 'T4A_ASAR_RAW_ENTRY_SENTINEL')
    await createPackage(sourceRoot, archive)

    const rawEntries = listPackage(archive)
    const entries = indexAsarEntries(rawEntries)
    const indexed = entries.byNormalizedName.get('/dist-desktop/desktop/main.js')

    assert.ok(indexed)
    assert.equal(indexed.rawName, String.raw`\dist-desktop\desktop\main.js`)
    assert.equal(indexed.extractionPath, indexed.rawName.slice(1))
    assert.equal(extractFile(archive, indexed.extractionPath).toString(), 'T4A_ASAR_RAW_ENTRY_SENTINEL')
    assert.throws(
      () => extractFile(archive, indexed.normalizedName.slice(1)),
      /was not found in this archive/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
