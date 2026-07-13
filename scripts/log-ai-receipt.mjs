#!/usr/bin/env node

import fs from 'node:fs/promises'
import process from 'node:process'
import { buildAiReceipt, receiptToTelemetryEvents } from '../src/lib/ai-receipts.ts'

function printHelp() {
  console.log(`Usage: node scripts/log-ai-receipt.mjs --input <command.json> [--json]

Expected command shape:
{
  "command": "ai_receipt.create",
  "producer": "codex",
  "sessionId": "optional",
  "payload": {
    "ticketId": "ticket-id",
    "projectProgressId": "project-progress-id",
    "agentSource": "Codex",
    "request": "what was asked",
    "summary": "what changed",
    "actionsTaken": [],
    "artifactRefs": [],
    "verification": [],
    "facts": [],
    "assumptions": [],
    "decisions": [],
    "recommendations": [],
    "openQuestions": [],
    "outcome": "proposed"
  }
}
`)
}

function parseArgs(argv) {
  const options = { input: undefined, json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--input') options.input = argv[++i]
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

async function readJsonInput(inputPath) {
  const text = inputPath
    ? await fs.readFile(inputPath, 'utf8')
    : await new Promise((resolve, reject) => {
      let data = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (chunk) => { data += chunk })
      process.stdin.on('end', () => resolve(data))
      process.stdin.on('error', reject)
    })
  return JSON.parse(text)
}

export function buildReceiptCommandOutput(command) {
  if (command?.command !== 'ai_receipt.create') {
    throw new Error('Expected command: ai_receipt.create')
  }
  if (!command.payload || typeof command.payload !== 'object') {
    throw new Error('Expected object payload')
  }

  const receipt = buildAiReceipt(command.payload)
  const telemetryEvents = receiptToTelemetryEvents(receipt)
  return {
    command: 'ai_receipt.create',
    producer: command.producer ?? 'local-bridge',
    sessionId: command.sessionId,
    receipt,
    telemetryEvents,
  }
}

if (process.argv[1]?.endsWith('log-ai-receipt.mjs')) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const command = await readJsonInput(options.input)
    const output = buildReceiptCommandOutput(command)
    if (options.json) {
      console.log(JSON.stringify(output, null, 2))
    } else {
      console.log('FindMnemo AI receipt dry-run')
      console.log(`Receipt: ${output.receipt.id}`)
      console.log(`Telemetry events: ${output.telemetryEvents.length}`)
      console.log('No state was written by this command.')
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
