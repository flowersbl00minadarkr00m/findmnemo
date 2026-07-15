import { describe, expect, it } from 'vitest'
import { ReporterSanitizer } from '../reporter/sanitizer.js'
import { ClaudeCodeActivityAdapter } from './claude-code-activity-adapter.js'

const options = {
  integrationId: 'claude-auto', agentVersion: '2.1.207', projectRef: { kind: 'unassigned' } as const,
  now: () => '2026-07-14T21:00:00.000Z',
  eventId: (() => { let value = 100; return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}` })(),
}

describe('Claude Code activity adapter', () => {
  it('drops private hook fields and maps session lifecycle without terminal inference', () => {
    const adapter = new ClaudeCodeActivityAdapter(options)
    const sanitizer = new ReporterSanitizer()
    const canary = 'CLAUDE-PRIVATE-CANARY'
    const source = (hook_event_name: string, extra: Record<string, unknown> = {}) => ({
      hook_event_name, session_id: 'claude-session-1', transcript_path: `C:/private/${canary}.jsonl`, cwd: 'C:/private/project',
      prompt: canary, last_assistant_message: canary, error_details: canary, task_description: canary, credentials: canary, ...extra,
    })
    const events = [
      adapter.select(source('SessionStart')),
      adapter.select(source('UserPromptSubmit')),
      adapter.select(source('Notification', { notification_type: 'permission_prompt' })),
      adapter.select(source('Stop')),
      adapter.select(source('StopFailure', { error: 'rate_limit' })),
    ]
    expect(events.map((event) => event?.kind)).toEqual(['accepted', 'started', 'needs-action', 'waiting', 'blocked'])
    expect(adapter.select(source('SessionEnd'))).toBeNull()
    for (const draft of events) expect(JSON.stringify(sanitizer.sanitizeDraft(draft!))).not.toContain(canary)
  })

  it('uses task identity and subject, and completes only that task', () => {
    const adapter = new ClaudeCodeActivityAdapter(options)
    const created = adapter.select({ hook_event_name: 'TaskCreated', session_id: 'session-1', task_id: 'task-7', task_subject: 'Verify the release', task_description: 'private detail' })!
    const completed = adapter.select({ hook_event_name: 'TaskCompleted', session_id: 'session-1', task_id: 'task-7', task_subject: 'Verify the release', task_description: 'private detail', output: 'private output' })!
    expect(created).toMatchObject({ originAssignmentId: 'task-7', summary: { text: 'Verify the release', source: 'claude-task-subject' }, evidenceKind: 'claude-task-hook' })
    expect(completed).toMatchObject({ originAssignmentId: 'task-7', kind: 'completed', terminalEvidence: { kind: 'claude-task-completed', outcome: 'completed' } })
    expect(adapter.select({ hook_event_name: 'TaskCompleted', session_id: 'session-1', task_subject: 'Missing ID' })).toBeNull()
  })

  it('fulfills a next-interaction snapshot without reading session storage', () => {
    const adapter = new ClaudeCodeActivityAdapter(options)
    adapter.armNextInteractionSnapshot({ requestId: 'snapshot-1', coverageStartedAt: '2026-07-14T20:59:00.000Z' })
    const drafts = adapter.selectMany({ hook_event_name: 'UserPromptSubmit', session_id: 'session-1', prompt: 'private' })
    expect(drafts).toHaveLength(2)
    expect(drafts[1]).toMatchObject({ kind: 'snapshot', snapshot: { requestId: 'snapshot-1', mode: 'next-interaction' } })
  })
})
