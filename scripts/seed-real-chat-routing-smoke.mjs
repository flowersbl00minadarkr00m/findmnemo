#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { openFindMnemoDatabase } from '../dist-companion/server/db/database.js'
import { RoutingRepository } from '../dist-companion/server/routing/routing-repository.js'

const databasePath = path.resolve(process.argv[2] ?? '')
const modelId = process.argv[3] ?? 'cohere/north-mini-code:free'
if (!databasePath || !databasePath.includes('findmnemo-routing-smoke-') || path.basename(databasePath) !== 'findmnemo.db') throw new Error('Smoke database must be a disposable findmnemo-routing-smoke-* path.')
if (existsSync(databasePath)) throw new Error('Refusing to overwrite an existing smoke database.')

const checkedAt = new Date()
const expiresAt = new Date(checkedAt.getTime() + 30 * 60_000)
const database = await openFindMnemoDatabase({ path: databasePath })
const repository = new RoutingRepository(database.db)
const result = repository.compareAndSetPolicy({
  schemaVersion: '2.0.0', policyProfile: 'findmnemo.model-routing.v2', policyVersion: 0, updatedAt: checkedAt.toISOString(),
  capabilities: [{ id: 'creation.writing', family: 'creation', label: 'Writing', description: 'Draft or revise written content.', origin: 'built-in' }],
  profiles: [{ id: 'profile:real-pi-smoke', displayName: 'Disposable real Pi smoke', destinationAdapterId: 'pi-rpc', destinationInstanceId: 'pi:default', providerId: 'openrouter', modelId, effort: 'high', capabilityIds: ['creation.writing'], enabled: true, behavior: 'auto-exact', fallbackOrder: 0, readiness: { state: 'ready', checkedAt: checkedAt.toISOString(), expiresAt: expiresAt.toISOString(), adapterVersion: '1.0.0', installedVersion: '0.80.3', reasonCode: null } }],
  defaultProfileOrder: ['profile:real-pi-smoke'], capabilityOverrides: [],
}, null)
database.close()
if (result.status !== 'saved') throw new Error('Disposable smoke policy was not created.')
process.stdout.write(JSON.stringify({ status: 'seeded', database: 'disposable', policyVersion: result.policy.policyVersion, modelId }) + '\n')
