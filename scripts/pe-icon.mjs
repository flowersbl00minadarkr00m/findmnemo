import { createHash } from 'node:crypto'
import {
  NtExecutable,
  NtExecutableResource,
  Resource,
  version as reseditVersion,
} from 'resedit'
import { inspectPng, validateIco } from './windows-icon.mjs'

export const PINNED_RESEDIT_VERSION = '1.7.2'

export function inspectPeIconGroups(executableBuffer) {
  if (reseditVersion !== PINNED_RESEDIT_VERSION) throw new Error('PE_ICON_RESEDIT_VERSION_MISMATCH')
  const executable = NtExecutable.from(Buffer.from(executableBuffer), { ignoreCert: true })
  const resources = NtExecutableResource.from(executable)
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries)
  return {
    tool: { resedit: reseditVersion },
    groupCount: groups.length,
    groups: groups.map((group) => ({
      id: group.id,
      lang: group.lang,
      payloads: group.icons.map((icon) => {
        const resource = resources.entries.find((entry) => (
          entry.type === 3 &&
          entry.id === icon.iconID &&
          entry.lang === group.lang
        ))
        if (!resource) throw new Error('PE_ICON_RESOURCE_MISSING')
        const payload = Buffer.from(resource.bin)
        const decoded = inspectPng(payload)
        const directoryWidth = icon.width || 256
        const directoryHeight = icon.height || 256
        if (decoded.width !== directoryWidth || decoded.height !== directoryHeight) {
          throw new Error('PE_ICON_RESOURCE_DIMENSION_MISMATCH')
        }
        return {
          iconId: icon.iconID,
          width: decoded.width,
          height: decoded.height,
          bitCount: icon.bitCount,
          bytes: payload.length,
          sha256: sha256(payload),
          payload,
        }
      }),
    })),
  }
}

export function assertPeIconMatchesIco(executableBuffer, icoBuffer) {
  const expected = validateIco(icoBuffer)
  const inspected = inspectPeIconGroups(executableBuffer)
  const expectedBySize = new Map(expected.entries.map((entry) => [entry.width, entry]))
  const groups = inspected.groups.map((group) => {
    const payloads = group.payloads
      .map((payload) => ({
        iconId: payload.iconId,
        width: payload.width,
        height: payload.height,
        bitCount: payload.bitCount,
        bytes: payload.bytes,
        sha256: payload.sha256,
        exactMatch: expectedBySize.get(payload.width)?.payload.equals(payload.payload) ?? false,
      }))
      .sort((left, right) => left.width - right.width)
    return {
      id: group.id,
      lang: group.lang,
      sizes: payloads.map((payload) => payload.width),
      payloads,
    }
  })
  const matchedGroup = groups.find((group) => (
    group.sizes.length === expected.sizes.length &&
    group.sizes.every((size, index) => size === expected.sizes[index]) &&
    group.payloads.every((payload) => payload.exactMatch)
  ))
  if (!matchedGroup) throw new Error('PE_ICON_GROUP_DOES_NOT_MATCH_CHECKED_IN_ICO')
  return {
    tool: inspected.tool,
    inspectedGroupCount: inspected.groupCount,
    matchedGroup,
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}
