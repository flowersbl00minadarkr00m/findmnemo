// Demo data — seeded on first visit when localStorage is empty.
// Mirrors realistic cross-agent workflows from the Elastic Mindset build series.
// All timestamps are generated relative to "now" so the dashboard and analytics
// charts always look current, even on a deploy viewed weeks later.

import type { Ticket, AgentActivity, EmailThread } from '../types'

/** ISO timestamp `days` days ago at the given hour (local). */
function daysAgo(days: number, hour = 12, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

export const DEMO_TICKETS: Ticket[] = [
  {
    id: 't1',
    title: 'Implement shared-brain recall in Post Pipeline stage transitions',
    description: 'Each pipeline stage transition should call brain.recall() to inherit prior decisions before producing new artifacts.',
    source: 'Codex',
    origin: 'demo',
    status: 'in-progress',
    workNotes: [
      { id: 'n1a', text: 'Recall works for Pi and Claude; verified the agent attribution field survives round-trips.', createdAt: daysAgo(2, 14, 30) },
      { id: 'n1b', text: 'One caveat: brain.remember needs the agent tag set correctly or retrieval filters break.', createdAt: daysAgo(2, 15) },
    ],
    artifacts: [
      { id: 'a1a', type: 'file', label: 'brain.py recall() integration', url: '#', createdAt: daysAgo(2, 14, 30) },
    ],
    decisionLog: [
      { id: 'd1a', timestamp: daysAgo(2, 15, 30), decision: 'Use agent attribution as primary filter in recall()', reasoning: 'Without it, agents retrieve each other\'s stale memories. The agent field is the simplest discriminator.', gateType: 'two-way', reversibility: 'high' },
    ],
    createdAt: daysAgo(2, 10),
    updatedAt: hoursAgo(3),
  },
  {
    id: 't2',
    title: 'Audit portable skills for harness-specific assumptions',
    description: 'Skills written for Pi may assume bash tool syntax that differs under Codex. Need a portability lint pass before the Elastic Mindset demo.',
    source: 'Pi',
    status: 'in-progress',
    workNotes: [
      { id: 'n2a', text: 'Ran skill-portability-lint on brave-search and browser-tools. Three platform assumptions found.', createdAt: daysAgo(2, 12) },
      { id: 'n2b', text: 'Same skills work under Claude Cowork with minor path adjustments.', createdAt: daysAgo(1, 8) },
      { id: 'n2c', text: 'Codex has no issue with the bash calls but error handling differs. Added try/catch wrap recommendation.', createdAt: daysAgo(1, 9) },
    ],
    artifacts: [],
    decisionLog: [
      { id: 'd2a', timestamp: daysAgo(1, 10), decision: 'Tag each skill with harness compatibility matrix', reasoning: 'Skills are the most reused assets across agents. A compat table in SKILL.md frontmatter prevents silent breakage.', gateType: 'two-way', reversibility: 'medium' },
    ],
    createdAt: daysAgo(2, 11),
    updatedAt: hoursAgo(5),
  },
  {
    id: 't3',
    title: 'Design FindMnemo demo data flow',
    description: 'Define what demo tasks look like and how they demonstrate continuity across LLM sessions.',
    source: 'Codex',
    origin: 'demo',
    status: 'done',
    workNotes: [
      { id: 'n3a', text: 'Proposed 6 demo tasks showing cross-agent handoffs. Each has reasoning notes from at least two agents.', createdAt: daysAgo(3, 16) },
      { id: 'n3b', text: 'Agreed. Added slipped-through-cracks view as a separate surface.', createdAt: daysAgo(1, 7) },
    ],
    artifacts: [
      { id: 'a3a', type: 'pr', label: 'feat: demo data with cross-agent narratives', url: '#', createdAt: daysAgo(1, 7) },
    ],
    decisionLog: [],
    createdAt: daysAgo(3, 13),
    updatedAt: daysAgo(1, 7),
  },
  {
    id: 't4',
    title: 'Add rollback capability to Supabase memory supersession',
    description: 'brain.supersede() replaces old memories but the old record should remain queryable with a superseded flag for traceability.',
    source: 'Claude Cowork',
    status: 'blocked',
    workNotes: [
      { id: 'n4a', text: 'Current implementation writes the new memory and marks the old as superseded in metadata. But recall() filters out superseded by default — no rollback to inspect.', createdAt: daysAgo(1, 10) },
    ],
    artifacts: [],
    decisionLog: [
      { id: 'd4a', timestamp: daysAgo(1, 10, 30), decision: 'Add a `superseded` boolean and expose it via recall(includeSuperseded=true)', reasoning: 'The data is already in the table. Adding a query param is simpler than a separate history table.', gateType: 'two-way', reversibility: 'high' },
    ],
    createdAt: daysAgo(1, 9),
    updatedAt: hoursAgo(20),
  },
  {
    id: 't5',
    title: 'Write Elastic Mindset opening section',
    description: 'Draft the opening: growth mindset asks whether abilities can improve; Elastic Mindset asks whether the role itself should change.',
    source: 'Pi',
    status: 'todo',
    workNotes: [
      { id: 'n5a', text: 'First cut reads too academic. Need a concrete anecdote to anchor the abstraction.', createdAt: daysAgo(2, 18) },
      { id: 'n5b', text: 'Use the CPA-to-systems-engineer transition as the personal through-line.', createdAt: daysAgo(1, 6) },
    ],
    artifacts: [
      { id: 'a5a', type: 'file', label: 'elastic-mindset-draft-v1.md', url: '#', createdAt: daysAgo(2, 18) },
    ],
    decisionLog: [],
    createdAt: daysAgo(2, 17),
    updatedAt: daysAgo(1, 6),
  },
  {
    id: 't6',
    title: 'Build Vercel deploy config for mnemosync demo',
    description: 'Ensure the demo deploys cleanly: no build errors, correct static asset paths, no env vars required.',
    source: 'Codex',
    origin: 'demo',
    status: 'todo',
    workNotes: [],
    artifacts: [],
    decisionLog: [],
    createdAt: hoursAgo(26),
    updatedAt: hoursAgo(26),
  },
  {
    id: 't7',
    title: 'Migrate shared-brain embeddings to pgvector HNSW index',
    description: 'Recall latency grows linearly with memory count. HNSW index on the embeddings column should bring p95 under 50ms.',
    source: 'Claude Cowork',
    status: 'done',
    workNotes: [
      { id: 'n7a', text: 'Benchmarked IVFFlat vs HNSW on 12k memories: HNSW wins at our scale, 41ms p95.', createdAt: daysAgo(6, 15) },
      { id: 'n7b', text: 'Migration applied on branch, merged after recall regression suite passed.', createdAt: daysAgo(5, 11) },
    ],
    artifacts: [
      { id: 'a7a', type: 'commit', label: 'migration: add HNSW index on memories.embedding', url: '#', createdAt: daysAgo(5, 11) },
    ],
    decisionLog: [
      { id: 'd7a', timestamp: daysAgo(6, 16), decision: 'HNSW over IVFFlat despite slower writes', reasoning: 'Memory writes are rare (~100/day); reads dominate. Read latency is the user-facing metric.', gateType: 'two-way', reversibility: 'medium' },
    ],
    createdAt: daysAgo(7, 9),
    updatedAt: daysAgo(5, 11),
  },
  {
    id: 't8',
    title: 'Define ticket schema contract shared by all three agents',
    description: 'Pi, Codex, and Claude each write tickets. One canonical TypeScript type + JSON schema so no agent drifts.',
    source: 'Pi',
    status: 'done',
    workNotes: [
      { id: 'n8a', text: 'Published types.ts as the single source of truth; JSON schema generated from it.', createdAt: daysAgo(9, 14) },
    ],
    artifacts: [
      { id: 'a8a', type: 'file', label: 'types.ts + ticket.schema.json', url: '#', createdAt: daysAgo(9, 14) },
    ],
    decisionLog: [
      { id: 'd8a', timestamp: daysAgo(9, 15), decision: 'TypeScript type is canonical, schema is generated', reasoning: 'The dashboard consumes the type directly; generating the schema avoids two sources of truth.', gateType: 'one-way', reversibility: 'low' },
    ],
    createdAt: daysAgo(10, 10),
    updatedAt: daysAgo(9, 14),
  },
  {
    id: 't9',
    title: 'Instrument agent session heartbeats',
    description: 'Agents should ping updateAgentState() every 60s while active so the sidebar pulse reflects reality, not last-write.',
    source: 'Codex',
    origin: 'demo',
    status: 'done',
    workNotes: [
      { id: 'n9a', text: 'Added heartbeat wrapper to the session bootstrap skill. All three harnesses covered.', createdAt: daysAgo(4, 13) },
    ],
    artifacts: [
      { id: 'a9a', type: 'commit', label: 'feat: session heartbeat in bootstrap skill', url: '#', createdAt: daysAgo(4, 13) },
    ],
    decisionLog: [],
    createdAt: daysAgo(5, 8),
    updatedAt: daysAgo(4, 13),
  },
  {
    id: 't10',
    title: 'Draft LinkedIn launch post for FindMnemo demo',
    description: 'Hook: "Your AI agents forget each other exists." Show the dashboard solving cross-agent amnesia in a 40-second clip.',
    source: 'Pi',
    status: 'in-progress',
    workNotes: [
      { id: 'n10a', text: 'Three hook variants drafted. The amnesia framing tests strongest with the pilot readers.', createdAt: hoursAgo(8) },
    ],
    artifacts: [],
    decisionLog: [],
    createdAt: daysAgo(1, 15),
    updatedAt: hoursAgo(8),
  },
  {
    id: 't11',
    title: 'Add retention policy for superseded memories',
    description: 'Superseded memories older than 90 days should archive to cold storage instead of bloating the recall index.',
    source: 'Claude Cowork',
    status: 'todo',
    workNotes: [],
    artifacts: [],
    decisionLog: [],
    createdAt: daysAgo(3, 9),
    updatedAt: daysAgo(3, 9),
  },
  {
    id: 't12',
    title: 'Cross-agent handoff test: Pi drafts, Codex implements, Claude reviews',
    description: 'End-to-end validation that a task can pass through all three agents with zero context re-explanation.',
    source: 'Codex',
    origin: 'demo',
    status: 'done',
    workNotes: [
      { id: 'n12a', text: 'Handoff completed in 3 sessions with zero re-explanation. brain.recall() surfaced all prior decisions.', createdAt: daysAgo(8, 17) },
    ],
    artifacts: [
      { id: 'a12a', type: 'url', label: 'handoff test transcript', url: '#', createdAt: daysAgo(8, 17) },
    ],
    decisionLog: [
      { id: 'd12a', timestamp: daysAgo(8, 18), decision: 'Handoff protocol is recall-first, ask-second', reasoning: 'Agents must query the shared brain before asking the human. Humans are the escalation path, not the default.', gateType: 'two-way', reversibility: 'high' },
    ],
    createdAt: daysAgo(11, 10),
    updatedAt: daysAgo(8, 17),
  },
]

export const DEMO_ACTIVITIES: AgentActivity[] = [
  { id: 'agent-pi', agent: 'Pi', state: 'waiting', currentTask: 'Awaiting review: LinkedIn launch post draft', lastActive: hoursAgo(1) },
  { id: 'agent-codex', agent: 'Codex', state: 'working', currentTask: 'brain.recall() pipeline integration', lastActive: new Date(Date.now() - 4 * 60_000).toISOString() },
  { id: 'agent-claude', agent: 'Claude Cowork', state: 'idle', currentTask: 'Last: pgvector HNSW migration', lastActive: hoursAgo(6) },
]

export const DEMO_EMAILS: EmailThread[] = [
  {
    id: 'e1',
    subject: 'Re: Elastic Mindset draft — feedback on section 3',
    from: 'Collab Partner <partner@example.com>',
    snippet: 'Hey Henry, Section 3 reads well but I think the decisiveness-through-elasticity thread gets buried. Can we surface it in the intro instead?',
    needsResponse: true,
    receivedAt: hoursAgo(4),
    messageId: 'demo-msg-1',
  },
  {
    id: 'e2',
    subject: 'Vercel deploy failing — build error on mnemosync',
    from: 'GitHub Notifications <notifications@github.com>',
    snippet: 'Build failed: src/components/Sidebar.tsx(12,5): error TS6133: \'AgentState\' is declared but its value is never read.',
    needsResponse: true,
    receivedAt: hoursAgo(6),
    messageId: 'demo-msg-2',
  },
  {
    id: 'e3',
    subject: 'Invitation: AI Builders roundtable — agent memory systems',
    from: 'AI Builders Collective <events@example.org>',
    snippet: 'We saw your cross-agent dashboard write-up. Would you present a 15-minute lightning talk on shared memory architectures next month?',
    needsResponse: true,
    receivedAt: hoursAgo(28),
    messageId: 'demo-msg-3',
  },
  {
    id: 'e4',
    subject: 'Supabase: your project passed 10k vector rows',
    from: 'Supabase <no-reply@supabase.io>',
    snippet: 'Heads up — the memories table crossed 10,000 rows this week. Current plan headroom: 82%. No action needed.',
    needsResponse: false,
    receivedAt: hoursAgo(50),
    messageId: 'demo-msg-4',
  },
]
