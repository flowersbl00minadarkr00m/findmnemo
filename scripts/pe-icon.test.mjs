import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'
import { assertPeIconMatchesIco } from './pe-icon.mjs'

test('PE icon-group inspection proves exact ICO payload correspondence', async () => {
  const ico = await readFile(new URL('../build/icon.ico', import.meta.url))
  const iconFile = Data.IconFile.from(ico)
  const executable = NtExecutable.createEmpty(false, false)
  const resources = NtExecutableResource.from(executable)
  Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    101,
    1033,
    iconFile.icons.map((item) => item.data),
  )
  resources.outputResource(executable)

  const evidence = assertPeIconMatchesIco(Buffer.from(executable.generate()), ico)
  assert.equal(evidence.matchedGroup.id, 101)
  assert.equal(evidence.matchedGroup.lang, 1033)
  assert.deepEqual(evidence.matchedGroup.sizes, [16, 32, 48, 256])
  assert.equal(evidence.matchedGroup.payloads.every((payload) => payload.exactMatch), true)
})
