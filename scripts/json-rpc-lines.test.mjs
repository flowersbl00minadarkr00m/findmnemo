import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_MAX_JSON_RPC_LINE_BYTES,
  createJsonRpcLinesParser,
} from './json-rpc-lines.mjs'

function response(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function collect(options = {}) {
  const messages = []
  const lines = []
  const parser = createJsonRpcLinesParser({
    ...options,
    onMessage(message, line) {
      messages.push(message)
      lines.push(line)
    },
  })
  return { parser, messages, lines }
}

test('retains a valid JSON-RPC line larger than 64 KiB across arbitrary chunks', () => {
  const expected = response(2, {
    tools: [{
      name: 'report_active_work',
      description: 'x'.repeat(70 * 1024),
    }],
  })
  const line = `${JSON.stringify(expected)}\n`
  assert.ok(Buffer.byteLength(line) > 64 * 1024)
  assert.ok(Buffer.byteLength(line) < DEFAULT_MAX_JSON_RPC_LINE_BYTES)

  const { parser, messages, lines } = collect()
  const bytes = Buffer.from(line)
  const chunkSizes = [1, 2, 7, 64, 1023, 8192, 3, 32768]
  let offset = 0
  let chunkIndex = 0
  while (offset < bytes.length) {
    const next = Math.min(bytes.length, offset + chunkSizes[chunkIndex % chunkSizes.length])
    parser.push(bytes.subarray(offset, next))
    offset = next
    chunkIndex += 1
  }
  parser.finish()

  assert.deepEqual(messages, [expected])
  assert.equal(lines.length, 1)
  assert.equal(lines[0], JSON.stringify(expected))
})

test('parses multiple complete lines exactly once across line and chunk boundaries', () => {
  const expected = [
    response(1, { protocolVersion: '2025-06-18' }),
    response(2, { tools: [] }),
    response(3, { structuredContent: { disposition: 'self-handled' } }),
  ]
  const payload = Buffer.from(`${expected.map((message) => JSON.stringify(message)).join('\n')}\n`)
  const boundaries = [5, payload.indexOf(0x0a) + 1, payload.indexOf(0x0a) + 4, payload.length - 1]
  const { parser, messages, lines } = collect()

  let offset = 0
  for (const boundary of boundaries) {
    if (boundary <= offset) continue
    parser.push(payload.subarray(offset, boundary))
    offset = boundary
  }
  parser.push(payload.subarray(offset))
  parser.finish()

  assert.deepEqual(messages, expected)
  assert.deepEqual(lines, expected.map((message) => JSON.stringify(message)))
})

test('decodes UTF-8 only after a complete multibyte sequence arrives', () => {
  const expected = response(7, { label: 'Claude \u{1F9E0} 日本語' })
  const bytes = Buffer.from(`${JSON.stringify(expected)}\n`)
  const brain = Buffer.from('\u{1F9E0}')
  const brainOffset = bytes.indexOf(brain)
  assert.ok(brainOffset > 0)
  const { parser, messages } = collect()

  parser.push(bytes.subarray(0, brainOffset + 1))
  parser.push(bytes.subarray(brainOffset + 1, brainOffset + 3))
  parser.push(bytes.subarray(brainOffset + 3))
  parser.finish()

  assert.deepEqual(messages, [expected])
})

test('rejects blank protocol lines', () => {
  const { parser } = collect()
  assert.throws(() => parser.push(Buffer.from('\n')), /MCP_JSONRPC_BLANK_LINE/)
})

test('rejects malformed JSON and non-response JSON-RPC lines', () => {
  const malformed = collect()
  assert.throws(
    () => malformed.parser.push(Buffer.from('{"jsonrpc":"2.0","id":1\n')),
    /MCP_JSONRPC_MALFORMED_LINE/,
  )

  const notification = collect()
  assert.throws(
    () => notification.parser.push(Buffer.from('{"jsonrpc":"2.0","method":"progress"}\n')),
    /MCP_JSONRPC_RESPONSE_ID_REQUIRED/,
  )

  const wrongVersion = collect()
  assert.throws(
    () => wrongVersion.parser.push(Buffer.from('{"jsonrpc":"1.0","id":1}\n')),
    /MCP_JSONRPC_VERSION_REQUIRED/,
  )
})

test('rejects a line that exceeds the explicit maximum before retaining it', () => {
  const maximum = 128
  const { parser } = collect({ maxLineBytes: maximum })
  const prefix = Buffer.from('{"jsonrpc":"2.0","id":1,"result":"')
  parser.push(prefix)

  assert.throws(
    () => parser.push(Buffer.from(`${'x'.repeat(maximum)}"}\n`)),
    new RegExp(`MCP_JSONRPC_LINE_TOO_LARGE:${maximum}`),
  )
  assert.ok(parser.bufferedBytes <= maximum)
})

test('rejects invalid UTF-8 in a complete line', () => {
  const { parser } = collect()
  const prefix = Buffer.from('{"jsonrpc":"2.0","id":1,"result":"')
  const suffix = Buffer.from('"}\n')
  assert.throws(
    () => parser.push(Buffer.concat([prefix, Buffer.from([0xc3, 0x28]), suffix])),
    /MCP_JSONRPC_INVALID_UTF8/,
  )
})

test('rejects an incomplete final fragment at EOF', () => {
  const { parser, messages } = collect()
  parser.push(Buffer.from(JSON.stringify(response(1, { ok: true }))))
  assert.deepEqual(messages, [])
  assert.throws(() => parser.finish(), /MCP_JSONRPC_INCOMPLETE_FINAL_LINE/)
})
