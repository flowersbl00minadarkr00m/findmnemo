#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { openFindMnemoDatabase } from '../dist-companion/server/db/database.js'
import { FakeDestinationAdapter } from '../dist-companion/server/routing/adapters/fake-adapter.js'
import { DispatchService } from '../dist-companion/server/routing/dispatch-service.js'
import { RoutingRepository } from '../dist-companion/server/routing/routing-repository.js'
import { createMcpHandler } from '../dist-companion/server/mcp/findmnemo-mcp.js'

const directory = await mkdtemp(join(tmpdir(), 'findmnemo-chat-routing-'))
const databasePath = join(directory, 'findmnemo.db')
const clock = () => new Date('2026-07-12T22:00:00.000Z')
const privateCanaries = ['ROUTING_PROMPT_PRIVATE_CANARY', 'ROUTING_RESULT_PRIVATE_CANARY', 'ROUTING_CREDENTIAL_PRIVATE_CANARY', 'C:\\Users\\private\\agent.log']

function commandVersion(command) {
  if (process.platform !== 'win32') return { command, available: false, version: null, reason: 'windows-only-release-gate' }
  const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${command} --version`], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
  const version = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split(/\r?\n/)[0] ?? ''
  return { command, available: result.status === 0 && version.length > 0, version: version || null }
}

try {
  assert.equal(process.platform, 'win32', 'Integrated chat-routing release gate currently qualifies Windows only.')
  const database = await openFindMnemoDatabase({ path: databasePath })
  const repository = new RoutingRepository(database.db)
  const policy = {
    schemaVersion: '2.0.0', policyProfile: 'findmnemo.model-routing.v2', policyVersion: 0, updatedAt: clock().toISOString(),
    capabilities: [{ id: 'creation.writing', family: 'creation', label: 'Writing', description: 'Draft or revise written content.', origin: 'built-in' }],
    profiles: [{ id: 'profile:writer', displayName: 'Verified writer', destinationAdapterId: 'fake', destinationInstanceId: 'fake:verified', providerId: 'verified-provider', modelId: 'verified-model', effort: 'high', capabilityIds: ['creation.writing'], enabled: true, behavior: 'auto-exact', fallbackOrder: 0, readiness: { state: 'ready', checkedAt: '2026-07-12T21:55:00.000Z', expiresAt: '2026-07-12T22:15:00.000Z', adapterVersion: '1.0.0', installedVersion: '1.0.0', reasonCode: null } }],
    defaultProfileOrder: ['profile:writer'], capabilityOverrides: [],
  }
  assert.equal(repository.compareAndSetPolicy(policy, null).status, 'saved')
  const adapter = new FakeDestinationAdapter()
  const dispatches = new DispatchService(repository, [adapter], clock)
  const transport = {
    recommend: async (input) => dispatches.preflight(input),
    dispatch: async (input) => dispatches.dispatch(input),
    getDispatch: async (id) => repository.getDispatchReceipt(id),
    cancelDispatch: async (id) => dispatches.cancel(id),
    acknowledgeDelivery: async (id) => dispatches.markDelivered(id),
  }
  const codex = createMcpHandler(transport, 'codex-mcp')
  const claude = createMcpHandler(transport, 'claude-code-mcp')
  for (const handler of [codex, claude]) {
    const initialized = await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    assert.equal(initialized.result.protocolVersion, '2025-06-18')
  }
  const baseArguments = { capabilityIds: ['creation.writing'], task: privateCanaries[0], userConfirmed: true }
  const codexResult = await codex({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'dispatch_work', arguments: { ...baseArguments, correlationId: 'codex-turn', idempotencyKey: 'codex-key' } } })
  const claudeResult = await claude({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dispatch_work', arguments: { ...baseArguments, correlationId: 'claude-turn', idempotencyKey: 'claude-key' } } })
  for (const result of [codexResult, claudeResult]) {
    assert.ok(result && !('error' in result), JSON.stringify(result))
    const structured = result.result.structuredContent
    assert.equal(structured.disposition, 'completed')
    assert.equal(structured.attribution.requested.modelId, 'verified-model')
    assert.equal(structured.attribution.actual.modelId, 'verified-model')
  }
  assert.equal(adapter.calls, 2, 'Each distinct origin call must execute exactly once.')
  await codex({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'dispatch_work', arguments: { ...baseArguments, correlationId: 'codex-turn', idempotencyKey: 'codex-key' } } })
  assert.equal(adapter.calls, 2, 'Duplicate idempotency keys must not execute again.')
  const self = await codex({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'recommend_route', arguments: { capabilityIds: ['creation.writing'], self: true } } })
  assert.equal(self.result.structuredContent.disposition, 'self-handled')
  const receipts = repository.listDispatchReceipts()
  assert.deepEqual(new Set(receipts.map((receipt) => receipt.origin.adapterId)), new Set(['codex-mcp', 'claude-code-mcp']))
  assert.ok(receipts.every((receipt) => receipt.returnState === 'delivered'))
  database.close()

  const stored = await readFile(databasePath)
  for (const canary of privateCanaries) assert.equal(stored.includes(Buffer.from(canary)), false, `Private canary persisted: ${canary}`)

  const versions = [commandVersion('codex'), commandVersion('claude'), commandVersion('pi')]
  assert.ok(versions.every((entry) => entry.available), `Required local tool unavailable: ${JSON.stringify(versions)}`)
  process.stdout.write(`${JSON.stringify({ status: 'pass', fakeSlice: { origins: 2, executions: adapter.calls, receipts: receipts.length, duplicateProtected: true, selfOverride: true, privateCanariesPersisted: false }, windowsTools: versions })}\n`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
