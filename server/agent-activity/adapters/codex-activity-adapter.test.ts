import { describe, expect, it } from 'vitest'
import { ReporterSanitizer } from '../reporter/sanitizer.js'
import { CodexActivityAdapter } from './codex-activity-adapter.js'

const options = {
  integrationId: 'codex-auto', agentVersion: '0.144.3', projectRef: { kind: 'approved-project', id: 'project-1' } as const,
  now: () => '2026-07-14T22:00:00.000Z',
  eventId: (() => { let value = 200; return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}` })(),
}

describe('Codex activity adapter', () => {
  it('maps safe lifecycle evidence while dropping prompts, tool details, permission detail, and transcripts', () => {
    const adapter = new CodexActivityAdapter(options)
    const sanitizer = new ReporterSanitizer()
    const canary = 'CODEX-PRIVATE-CANARY'
    const source = (hook_event_name: string, extra: Record<string, unknown> = {}) => ({
      hook_event_name, session_id: 'codex-session-1', turn_id: 'turn-4', model: 'gpt-5',
      transcript_path: `C:/private/${canary}.jsonl`, prompt: canary, assistant_text: canary,
      tool_input: { command: canary, description: canary }, tool_response: { output: canary }, environment: { SECRET: canary }, ...extra,
    })
    const drafts = [
      adapter.select(source('SessionStart')),
      adapter.select(source('UserPromptSubmit')),
      adapter.select(source('PostToolUse', { tool_name: 'Bash' })),
      adapter.select(source('PermissionRequest', { tool_name: 'Bash' })),
      adapter.select(source('Stop')),
      adapter.select(source('Notification', { notification_type: 'agent-turn-complete' })),
    ]
    expect(drafts.map((draft) => draft?.kind)).toEqual(['accepted', 'started', 'heartbeat', 'needs-action', 'waiting', 'waiting'])
    for (const draft of drafts) {
      const event = sanitizer.sanitizeDraft(draft!)
      expect(JSON.stringify(event)).not.toContain(canary)
      expect(event.assignment.originAssignmentId).toBe('codex-session-1')
    }
  })

  it('never derives terminal state and refreshes one stable assignment per session', () => {
    const adapter = new CodexActivityAdapter(options)
    const first = adapter.select({ hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1', prompt: 'private one' })!
    const second = adapter.select({ hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-2', prompt: 'private two' })!
    expect(first.originAssignmentId).toBe(second.originAssignmentId)
    expect(first.terminalEvidence).toBeUndefined()
    expect(second.terminalEvidence).toBeUndefined()
    expect(() => adapter.select({ hook_event_name: 'completed', session_id: 'session-1' })).toThrow('CODEX_EVENT_INVALID')
  })

  it('records next-interaction snapshot and rejects unqualified versions', () => {
    const adapter = new CodexActivityAdapter(options)
    adapter.armNextInteractionSnapshot({ requestId: 'snapshot-2', coverageStartedAt: '2026-07-14T21:59:00.000Z' })
    expect(adapter.selectMany({ hook_event_name: 'UserPromptSubmit', session_id: 'session-1', prompt: 'private' })[1])
      .toMatchObject({ kind: 'snapshot', snapshot: { mode: 'next-interaction', requestId: 'snapshot-2' } })
    expect(() => new CodexActivityAdapter({ ...options, agentVersion: '0.145.0' })).toThrow('CODEX_VERSION_UNSUPPORTED')
  })
})
