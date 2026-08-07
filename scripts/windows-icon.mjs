#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { Resvg } from '@resvg/resvg-js'

export const WINDOWS_ICON_SIZES = Object.freeze([16, 32, 48, 256])
export const WINDOWS_ICON_GENERATOR = 'findmnemo-windows-icon-v1'
export const PINNED_RESVG_VERSION = '2.6.2'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const sourcePath = fileURLToPath(new URL('../build/icon.svg', import.meta.url))
const iconPath = fileURLToPath(new URL('../build/icon.ico', import.meta.url))
const manifestPath = fileURLToPath(new URL('../build/icon.manifest.json', import.meta.url))
const resvgPackagePath = new URL('../node_modules/@resvg/resvg-js/package.json', import.meta.url)

export async function generateIcoFromSvg(source) {
  const payloads = WINDOWS_ICON_SIZES.map((size) => {
    const renderer = new Resvg(source, {
      fitTo: { mode: 'width', value: size },
    })
    const payload = Buffer.from(renderer.render().asPng())
    const decoded = inspectPng(payload)
    assert.equal(decoded.width, size, 'WINDOWS_ICON_GENERATOR_WIDTH_MISMATCH')
    assert.equal(decoded.height, size, 'WINDOWS_ICON_GENERATOR_HEIGHT_MISMATCH')
    return payload
  })

  const directoryBytes = 6 + (16 * payloads.length)
  const totalBytes = directoryBytes + payloads.reduce((total, payload) => total + payload.length, 0)
  const output = Buffer.alloc(totalBytes)
  output.writeUInt16LE(0, 0)
  output.writeUInt16LE(1, 2)
  output.writeUInt16LE(payloads.length, 4)
  let payloadOffset = directoryBytes
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index]
    const size = WINDOWS_ICON_SIZES[index]
    const directoryOffset = 6 + (16 * index)
    output.writeUInt8(size === 256 ? 0 : size, directoryOffset)
    output.writeUInt8(size === 256 ? 0 : size, directoryOffset + 1)
    output.writeUInt8(0, directoryOffset + 2)
    output.writeUInt8(0, directoryOffset + 3)
    output.writeUInt16LE(1, directoryOffset + 4)
    output.writeUInt16LE(32, directoryOffset + 6)
    output.writeUInt32LE(payload.length, directoryOffset + 8)
    output.writeUInt32LE(payloadOffset, directoryOffset + 12)
    payload.copy(output, payloadOffset)
    payloadOffset += payload.length
  }
  return output
}

export function validateIco(input) {
  const buffer = Buffer.from(input)
  if (buffer.length < 6) throw new Error('ICO_HEADER_TRUNCATED')
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) throw new Error('ICO_HEADER_INVALID')
  const count = buffer.readUInt16LE(4)
  if (count !== WINDOWS_ICON_SIZES.length) throw new Error('ICO_ENTRY_COUNT_INVALID')
  const directoryEnd = 6 + (16 * count)
  if (directoryEnd > buffer.length) throw new Error('ICO_DIRECTORY_BOUNDS')

  const ranges = []
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const directoryOffset = 6 + (16 * index)
    const width = buffer.readUInt8(directoryOffset) || 256
    const height = buffer.readUInt8(directoryOffset + 1) || 256
    const colors = buffer.readUInt8(directoryOffset + 2)
    const reserved = buffer.readUInt8(directoryOffset + 3)
    const planes = buffer.readUInt16LE(directoryOffset + 4)
    const bitCount = buffer.readUInt16LE(directoryOffset + 6)
    const payloadBytes = buffer.readUInt32LE(directoryOffset + 8)
    const payloadOffset = buffer.readUInt32LE(directoryOffset + 12)
    const payloadEnd = payloadOffset + payloadBytes
    if (
      payloadOffset < directoryEnd ||
      payloadBytes < PNG_SIGNATURE.length ||
      payloadEnd > buffer.length ||
      payloadEnd < payloadOffset
    ) throw new Error('ICO_DIRECTORY_BOUNDS')
    if (width !== height || colors !== 0 || reserved !== 0 || planes !== 1 || bitCount !== 32) {
      throw new Error('ICO_DIRECTORY_ENTRY_INVALID')
    }
    if (ranges.some(([start, end]) => payloadOffset < end && payloadEnd > start)) {
      throw new Error('ICO_PAYLOAD_OVERLAP')
    }
    ranges.push([payloadOffset, payloadEnd])

    const payload = buffer.subarray(payloadOffset, payloadEnd)
    const decoded = inspectPng(payload)
    if (decoded.width !== width || decoded.height !== height) {
      throw new Error('ICO_DIRECTORY_PAYLOAD_DIMENSION_MISMATCH')
    }
    if (decoded.colorType !== 'rgba' || decoded.alpha.transparentPixels === 0 || decoded.alpha.visiblePixels === 0) {
      throw new Error('ICO_ALPHA_INVALID')
    }
    entries.push({
      index,
      width,
      height,
      planes,
      bitCount,
      format: 'png',
      payloadBytes,
      payloadOffset,
      payloadSha256: sha256(payload),
      payload: Buffer.from(payload),
      colorType: decoded.colorType,
      alpha: decoded.alpha,
    })
  }

  const sizes = entries.map((entry) => entry.width)
  if (new Set(sizes).size !== sizes.length) throw new Error('ICO_DIMENSIONS_DUPLICATE')
  if (!sizes.every((size, index) => size === WINDOWS_ICON_SIZES[index])) throw new Error('ICO_DIMENSIONS_INVALID')
  if (!entries.some((entry) => entry.width === 256 && entry.payloadBytes > 1024)) {
    throw new Error('ICO_256_PAYLOAD_INVALID')
  }
  return { sizes, entries }
}

export async function verifyWindowsIconBuffers({ source, checkedInIcon, manifest }) {
  const generated = await generateIcoFromSvg(source)
  if (!Buffer.from(checkedInIcon).equals(generated)) {
    throw new Error(`WINDOWS_ICON_OUT_OF_DATE:${sha256(source)}:${sha256(checkedInIcon)}:${sha256(generated)}`)
  }
  const validated = validateIco(checkedInIcon)
  const resvgPackage = JSON.parse(await readFile(resvgPackagePath, 'utf8'))
  if (resvgPackage.version !== PINNED_RESVG_VERSION) throw new Error('WINDOWS_ICON_RESVG_VERSION_MISMATCH')
  const evidence = {
    schema: 'findmnemo.windows-icon-evidence.v1',
    generator: WINDOWS_ICON_GENERATOR,
    tools: {
      node: process.version,
      resvg: resvgPackage.version,
    },
    sourceSha256: sha256(source),
    outputSha256: sha256(checkedInIcon),
    outputBytes: checkedInIcon.length,
    sizes: validated.sizes,
    entries: validated.entries,
  }
  if (!manifest || JSON.stringify(manifest) !== JSON.stringify(printableEvidence(evidence))) {
    throw new Error('WINDOWS_ICON_PROVENANCE_DRIFT')
  }
  return evidence
}

export async function verifyCheckedInWindowsIcon(options = {}) {
  const resolvedSourcePath = options.sourcePath ?? sourcePath
  const resolvedIconPath = options.iconPath ?? iconPath
  const resolvedManifestPath = options.manifestPath ?? manifestPath
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'findmnemo-windows-icon-'))
  try {
    const source = await readFile(resolvedSourcePath)
    const checkedInIcon = await readFile(resolvedIconPath)
    const manifest = JSON.parse(await readFile(resolvedManifestPath, 'utf8'))
    const regeneratedPath = join(temporaryRoot, 'icon.ico')
    await writeFile(regeneratedPath, await generateIcoFromSvg(source))
    const regenerated = await readFile(regeneratedPath)
    if (!regenerated.equals(checkedInIcon)) {
      throw new Error(`WINDOWS_ICON_OUT_OF_DATE:${sha256(source)}:${sha256(checkedInIcon)}:${sha256(regenerated)}`)
    }
    return await verifyWindowsIconBuffers({ source, checkedInIcon, manifest })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

export async function generateCheckedInWindowsIcon(options = {}) {
  const resolvedSourcePath = options.sourcePath ?? sourcePath
  const resolvedIconPath = options.iconPath ?? iconPath
  const resolvedManifestPath = options.manifestPath ?? manifestPath
  const source = await readFile(resolvedSourcePath)
  const output = await generateIcoFromSvg(source)
  const validated = validateIco(output)
  const resvgPackage = JSON.parse(await readFile(resvgPackagePath, 'utf8'))
  const evidence = {
    schema: 'findmnemo.windows-icon-evidence.v1',
    generator: WINDOWS_ICON_GENERATOR,
    tools: {
      node: process.version,
      resvg: resvgPackage.version,
    },
    sourceSha256: sha256(source),
    outputSha256: sha256(output),
    outputBytes: output.length,
    sizes: validated.sizes,
    entries: validated.entries,
  }
  await writeFile(resolvedIconPath, output)
  await writeFile(resolvedManifestPath, `${JSON.stringify(printableEvidence(evidence), null, 2)}\n`)
  return verifyCheckedInWindowsIcon({
    sourcePath: resolvedSourcePath,
    iconPath: resolvedIconPath,
    manifestPath: resolvedManifestPath,
  })
}

export function inspectPng(input) {
  const buffer = Buffer.from(input)
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('PNG_SIGNATURE_INVALID')
  }
  let offset = PNG_SIGNATURE.length
  let ihdr
  let ended = false
  const idat = []
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error('PNG_CHUNK_BOUNDS')
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    if (dataEnd < dataStart || chunkEnd > buffer.length) throw new Error('PNG_CHUNK_BOUNDS')
    const expectedCrc = buffer.readUInt32BE(dataEnd)
    const actualCrc = crc32(buffer.subarray(offset + 4, dataEnd))
    if (actualCrc !== expectedCrc) throw new Error('PNG_CHUNK_CRC_INVALID')
    const data = buffer.subarray(dataStart, dataEnd)
    if (type === 'IHDR') {
      if (ihdr || length !== 13) throw new Error('PNG_IHDR_INVALID')
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data.readUInt8(8),
        colorTypeCode: data.readUInt8(9),
        compression: data.readUInt8(10),
        filter: data.readUInt8(11),
        interlace: data.readUInt8(12),
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('PNG_IEND_INVALID')
      ended = true
      offset = chunkEnd
      break
    }
    offset = chunkEnd
  }
  if (!ihdr || !ended || offset !== buffer.length || idat.length === 0) throw new Error('PNG_STRUCTURE_INVALID')
  if (
    ihdr.width === 0 ||
    ihdr.height === 0 ||
    ihdr.bitDepth !== 8 ||
    ihdr.colorTypeCode !== 6 ||
    ihdr.compression !== 0 ||
    ihdr.filter !== 0 ||
    ihdr.interlace !== 0
  ) throw new Error('PNG_FORMAT_INVALID')

  const bytesPerPixel = 4
  const stride = ihdr.width * bytesPerPixel
  const inflated = inflateSync(Buffer.concat(idat))
  if (inflated.length !== (stride + 1) * ihdr.height) throw new Error('PNG_DECODED_SIZE_INVALID')
  let inputOffset = 0
  let previous = Buffer.alloc(stride)
  let transparentPixels = 0
  let visiblePixels = 0
  for (let row = 0; row < ihdr.height; row += 1) {
    const filter = inflated.readUInt8(inputOffset)
    inputOffset += 1
    const encoded = inflated.subarray(inputOffset, inputOffset + stride)
    inputOffset += stride
    const decoded = decodePngScanline(filter, encoded, previous, bytesPerPixel)
    for (let alphaOffset = 3; alphaOffset < decoded.length; alphaOffset += bytesPerPixel) {
      const alpha = decoded[alphaOffset]
      if (alpha < 255) transparentPixels += 1
      if (alpha > 0) visiblePixels += 1
    }
    previous = decoded
  }
  return {
    width: ihdr.width,
    height: ihdr.height,
    bitDepth: ihdr.bitDepth,
    colorType: 'rgba',
    alpha: { transparentPixels, visiblePixels },
  }
}

function decodePngScanline(filter, encoded, previous, bytesPerPixel) {
  const decoded = Buffer.alloc(encoded.length)
  for (let index = 0; index < encoded.length; index += 1) {
    const left = index >= bytesPerPixel ? decoded[index - bytesPerPixel] : 0
    const up = previous[index] ?? 0
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0
    let prediction
    if (filter === 0) prediction = 0
    else if (filter === 1) prediction = left
    else if (filter === 2) prediction = up
    else if (filter === 3) prediction = Math.floor((left + up) / 2)
    else if (filter === 4) prediction = paeth(left, up, upLeft)
    else throw new Error('PNG_FILTER_INVALID')
    decoded[index] = (encoded[index] + prediction) & 0xff
  }
  return decoded
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  if (upDistance <= upLeftDistance) return up
  return upLeft
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function printableEvidence(evidence) {
  return {
    ...evidence,
    entries: evidence.entries.map(({ payload: _payload, ...entry }) => entry),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`))) {
  const action = process.argv[2]
  if (action === 'generate') console.log(JSON.stringify(printableEvidence(await generateCheckedInWindowsIcon()), null, 2))
  else if (action === 'check') console.log(JSON.stringify(printableEvidence(await verifyCheckedInWindowsIcon()), null, 2))
  else throw new Error('WINDOWS_ICON_ACTION_REQUIRED')
}
