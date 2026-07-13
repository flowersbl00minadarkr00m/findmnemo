import type { AiReceipt, AiReceiptOutcome, ArtifactRef, LLMSource, WorkTelemetryEvent } from '../types'

const SECRET_PATTERNS = [
  { label: 'Supabase service role key', pattern: /\b(service_role|SUPABASE_SERVICE_ROLE_KEY|sb_secret_)[A-Za-z0-9_-]*/i },
  { label: 'OpenAI-style secret key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'Raw chain-of-thought marker', pattern: /\b(chain[- ]of[- ]thought|hidden reasoning|raw reasoning trace)\b/i },
]

function stableSegment(value: string): string {
  const normalized = value.trim().toLowerCase()
  const safe = normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return safe || 'unknown'
}

function now(): string {
  return new Date().toISOString()
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function inspectForSecrets(value: unknown, path: string, findings: string[]): void {
  if (typeof value === 'string') {
    for (const { label, pattern } of SECRET_PATTERNS) {
      if (pattern.test(value)) findings.push(`${path}: ${label}`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForSecrets(item, `${path}[${index}]`, findings))
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      inspectForSecrets(child, path ? `${path}.${key}` : key, findings)
    }
  }
}

export function findReceiptPrivacyFindings(input: unknown): string[] {
  const findings: string[] = []
  inspectForSecrets(input, 'receipt', findings)
  return findings
}

export function assertReceiptPrivacy(input: unknown): void {
  const findings = findReceiptPrivacyFindings(input)
  if (findings.length > 0) {
    throw new Error(`Receipt contains prohibited private content: ${findings.join('; ')}`)
  }
}

export function buildAiReceipt(input: {
  id?: string
  ticketId?: string
  projectProgressId?: string
  agentSource: LLMSource | 'FindMnemo' | string
  modelOrSurface?: string
  request: string
  summary: string
  actionsTaken?: AiReceipt['actionsTaken']
  artifactRefs?: ArtifactRef[]
  verification?: AiReceipt['verification']
  facts?: string[]
  assumptions?: string[]
  decisions?: string[]
  recommendations?: string[]
  openQuestions?: string[]
  outcome?: AiReceiptOutcome
  humanDisposition?: AiReceipt['humanDisposition']
  createdAt?: string
}): AiReceipt {
  assertReceiptPrivacy(input)
  const target = input.ticketId ?? input.projectProgressId ?? input.request
  return {
    id: input.id ?? `ai-receipt:${stableSegment(target)}:${stableSegment(input.agentSource)}`,
    ...(input.ticketId ? { ticketId: input.ticketId } : {}),
    ...(input.projectProgressId ? { projectProgressId: input.projectProgressId } : {}),
    agentSource: input.agentSource,
    ...(input.modelOrSurface ? { modelOrSurface: input.modelOrSurface } : {}),
    request: input.request,
    summary: input.summary,
    actionsTaken: asArray(input.actionsTaken),
    artifactRefs: asArray(input.artifactRefs),
    verification: asArray(input.verification),
    facts: asArray(input.facts),
    assumptions: asArray(input.assumptions),
    decisions: asArray(input.decisions),
    recommendations: asArray(input.recommendations),
    openQuestions: asArray(input.openQuestions),
    outcome: input.outcome ?? 'proposed',
    ...(input.humanDisposition ? { humanDisposition: input.humanDisposition } : {}),
    createdAt: input.createdAt ?? now(),
  }
}

export function receiptToTelemetryEvents(receipt: AiReceipt): WorkTelemetryEvent[] {
  const caseId = receipt.ticketId ?? receipt.projectProgressId ?? receipt.id
  const resultStatus = receipt.outcome === 'rejected' ? 'failure' : 'success'
  return [{
    eventId: `mnemo-receipt-${stableSegment(receipt.id)}`,
    caseId,
    traceId: `receipt-${receipt.id}`,
    timestamp: receipt.createdAt,
    sequence: 0,
    intent: receipt.request,
    activity: {
      id: 'ai-receipt-created',
      label: 'AI receipt created',
      type: 'review',
      primitiveVersion: '1.0.0',
    },
    actor: {
      id: `agent-${stableSegment(receipt.agentSource)}`,
      label: receipt.agentSource,
      type: receipt.agentSource === 'FindMnemo' ? 'system' : 'agent',
      role: 'AI work agent',
      authorityLevel: 3,
    },
    objects: [
      {
        id: receipt.id,
        type: 'ai-receipt',
        role: 'subject',
        sourceRef: `mnemosync://ai-receipt/${receipt.id}`,
        classification: 'private-work-data',
      },
      ...(receipt.ticketId ? [{
        id: receipt.ticketId,
        type: 'mnemosync-ticket',
        role: 'evidence' as const,
        sourceRef: `mnemosync://ticket/${receipt.ticketId}`,
        classification: 'private-work-data',
      }] : []),
      ...(receipt.projectProgressId ? [{
        id: receipt.projectProgressId,
        type: 'sdd-project-progress',
        role: 'evidence' as const,
        sourceRef: `mnemosync://project-progress/${receipt.projectProgressId}`,
        classification: 'private-work-data',
      }] : []),
    ],
    result: {
      status: resultStatus,
      message: receipt.summary,
    },
    evidence: receipt.artifactRefs.map((ref, index) => ({
      id: `receipt-evidence-${index + 1}`,
      sourceRef: ref.ref,
      label: ref.label,
      classification: ref.visibility === 'public' ? 'public-metadata' : 'private-work-data',
    })),
    acceptedOutcome: false,
    truthState: 'observed',
    provenance: {
      sourceType: 'mnemosync',
      sourceRef: `mnemosync://ai-receipt/${receipt.id}`,
      ingestedAt: receipt.createdAt,
      transformation: 'FindMnemo AI receipt event',
    },
    tags: ['mnemosync', 'ai-receipt', receipt.outcome],
  }]
}
