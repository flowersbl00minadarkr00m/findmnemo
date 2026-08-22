-- FindMnemo telemetry_events table
-- Single source of truth for cross-agent work telemetry.
-- Pi, Codex, and Claude Cowork write via service role key.
-- Operational rows are service-role only. Public browser builds import
-- explicit user-selected exports instead of reading this table.

CREATE TABLE IF NOT EXISTS telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL,
  trace_id TEXT,
  parent_event_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence INTEGER NOT NULL DEFAULT 0,
  intent TEXT,
  activity JSONB NOT NULL,
  transition JSONB,
  actor JSONB NOT NULL,
  objects JSONB,
  decision JSONB,
  result JSONB NOT NULL DEFAULT '{"status": "success"}'::jsonb,
  evidence JSONB,
  accepted_outcome BOOLEAN,
  truth_state TEXT NOT NULL DEFAULT 'observed',
  provenance JSONB NOT NULL,
  tags TEXT[] DEFAULT '{}',
  agent_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying by ticket (case_id)
CREATE INDEX IF NOT EXISTS idx_telemetry_case_id ON telemetry_events (case_id);

-- Index for time-range queries (dashboard sparkline, analytics)
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_events (timestamp DESC);

-- Index for agent source filtering
CREATE INDEX IF NOT EXISTS idx_telemetry_agent_source ON telemetry_events (agent_source);

-- Realtime remains available to trusted server-side consumers.
ALTER PUBLICATION supabase_realtime ADD TABLE telemetry_events;

-- Service role bypasses RLS. Browser roles receive no table access.
ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE telemetry_events FROM anon, authenticated;
DROP POLICY IF EXISTS "anon_can_read_telemetry" ON telemetry_events;
