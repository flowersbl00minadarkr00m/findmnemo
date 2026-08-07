import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  WINDOWS_ICON_SIZES,
  validateIco,
  verifyWindowsIconBuffers,
} from './windows-icon.mjs'

const source = await readFile(new URL('../build/icon.svg', import.meta.url))
const checkedInIcon = await readFile(new URL('../build/icon.ico', import.meta.url))
const manifest = JSON.parse(await readFile(new URL('../build/icon.manifest.json', import.meta.url), 'utf8'))

test('the checked-in Windows icon is a byte-identical derivation with real RGBA payloads', async () => {
  const evidence = await verifyWindowsIconBuffers({ source, checkedInIcon, manifest })

  assert.deepEqual(evidence.sizes, WINDOWS_ICON_SIZES)
  assert.equal(evidence.entries.every((entry) => entry.format === 'png'), true)
  assert.equal(evidence.entries.every((entry) => entry.colorType === 'rgba'), true)
  assert.equal(evidence.entries.every((entry) => entry.alpha.transparentPixels > 0), true)
  assert.equal(evidence.entries.every((entry) => entry.alpha.visiblePixels > 0), true)
  assert.equal(evidence.entries.at(-1)?.width, 256)
  assert.ok(evidence.entries.at(-1)?.payloadBytes > 1024)
})

test('source drift fails byte-for-byte provenance', async () => {
  const driftedSource = Buffer.concat([source, Buffer.from('\n')])
  await assert.rejects(
    verifyWindowsIconBuffers({ source: driftedSource, checkedInIcon, manifest }),
    /WINDOWS_ICON_PROVENANCE_DRIFT/,
  )
})

test('directory bounds and decoded payload dimensions are independently enforced', () => {
  const outOfBounds = Buffer.from(checkedInIcon)
  outOfBounds.writeUInt32LE(outOfBounds.length - 1, 6 + 12)
  assert.throws(() => validateIco(outOfBounds), /ICO_DIRECTORY_BOUNDS/)

  const falseDirectoryDimension = Buffer.from(checkedInIcon)
  falseDirectoryDimension.writeUInt8(15, 6)
  falseDirectoryDimension.writeUInt8(15, 7)
  assert.throws(
    () => validateIco(falseDirectoryDimension),
    /ICO_DIRECTORY_PAYLOAD_DIMENSION_MISMATCH/,
  )
})
