export const DEFAULT_MAX_JSON_RPC_LINE_BYTES = 1024 * 1024

export function createJsonRpcLinesParser({
  maxLineBytes = DEFAULT_MAX_JSON_RPC_LINE_BYTES,
  onMessage,
} = {}) {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) {
    throw new Error('MCP_JSONRPC_MAX_LINE_BYTES_INVALID')
  }
  if (typeof onMessage !== 'function') {
    throw new Error('MCP_JSONRPC_MESSAGE_HANDLER_REQUIRED')
  }

  let bufferedChunks = []
  let bufferedBytes = 0
  let closed = false
  let failure

  function fail(error) {
    failure = error
    throw error
  }

  function requireWritable() {
    if (failure) throw failure
    if (closed) throw new Error('MCP_JSONRPC_PARSER_CLOSED')
  }

  function consumeCompleteLine() {
    if (bufferedBytes === 0) fail(new Error('MCP_JSONRPC_BLANK_LINE'))

    const bytes = bufferedChunks.length === 1
      ? bufferedChunks[0]
      : Buffer.concat(bufferedChunks, bufferedBytes)
    bufferedChunks = []
    bufferedBytes = 0

    let line
    try {
      line = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      fail(new Error('MCP_JSONRPC_INVALID_UTF8'))
    }

    let message
    try {
      message = JSON.parse(line)
    } catch {
      fail(new Error('MCP_JSONRPC_MALFORMED_LINE'))
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      fail(new Error('MCP_JSONRPC_OBJECT_REQUIRED'))
    }
    if (message.jsonrpc !== '2.0') fail(new Error('MCP_JSONRPC_VERSION_REQUIRED'))
    if (message.id === undefined) fail(new Error('MCP_JSONRPC_RESPONSE_ID_REQUIRED'))

    try {
      onMessage(message, line)
    } catch (cause) {
      fail(cause)
    }
  }

  return {
    get bufferedBytes() {
      return bufferedBytes
    },

    push(chunk) {
      requireWritable()
      const bytes = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
          : Buffer.from(String(chunk))
      let offset = 0

      while (offset < bytes.length) {
        const newline = bytes.indexOf(0x0a, offset)
        const end = newline === -1 ? bytes.length : newline
        const segmentLength = end - offset
        if (bufferedBytes + segmentLength > maxLineBytes) {
          fail(new Error(`MCP_JSONRPC_LINE_TOO_LARGE:${maxLineBytes}`))
        }
        if (segmentLength > 0) {
          bufferedChunks.push(Buffer.from(bytes.subarray(offset, end)))
          bufferedBytes += segmentLength
        }
        if (newline === -1) break

        consumeCompleteLine()
        offset = newline + 1
      }
    },

    finish() {
      requireWritable()
      closed = true
      if (bufferedBytes > 0) {
        fail(new Error('MCP_JSONRPC_INCOMPLETE_FINAL_LINE'))
      }
    },
  }
}
