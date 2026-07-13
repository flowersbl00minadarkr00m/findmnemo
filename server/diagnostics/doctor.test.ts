import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCompanionDoctor } from './doctor.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

describe('companion doctor', () => {
  it('distinguishes stopped from an occupied identity-mismatch port and emits no local paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-doctor-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const credentialCapability = { backend: 'windows-dpapi' as const, state: 'available' as const, code: 'CREDENTIAL_STORE_AVAILABLE', guidance: 'Available locally.' }
    const stopped = await runCompanionDoctor({ port: 0, localAppData: directory, credentialCapability })
    expect(stopped).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'listener', state: 'attention', code: 'COMPANION_STOPPED' }),
      expect.objectContaining({ id: 'database', state: 'attention', code: 'DATABASE_NOT_CREATED' }),
    ]))

    const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"data":{"protocolVersion":"other"}}') })
    await listen(server)
    cleanup.push(() => new Promise((resolve) => server.close(() => resolve())))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture listener missing')
    const occupied = await runCompanionDoctor({ port: address.port, localAppData: directory, credentialCapability })
    expect(occupied).toContainEqual(expect.objectContaining({ id: 'listener', state: 'fail', code: 'IDENTITY_MISMATCH' }))
    expect(JSON.stringify({ stopped, occupied })).not.toContain(directory)
  })

  it('reports injected locked keyring capability without raw native details', async () => {
    const checks = await runCompanionDoctor({ port: 0, localAppData: 'C:\\safe-fixture', credentialCapability: { backend: 'linux-secret-service', state: 'locked', code: 'CREDENTIAL_STORE_UNAVAILABLE', guidance: 'Unlock the local credential store, then retry.' } })
    expect(checks).toContainEqual(expect.objectContaining({ id: 'gmail-credential', state: 'attention', code: 'CREDENTIAL_STORE_UNAVAILABLE' }))
    expect(JSON.stringify(checks)).not.toMatch(/account|token|secret|native error|safe-fixture/i)
  })
})

function listen(server: Server): Promise<void> { return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)) }
