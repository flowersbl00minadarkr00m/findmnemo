# Agent activity setup, compatibility, and privacy

Agent activity is an opt-in local companion feature. It creates one privacy-minimized ticket per reported assignment; it does not create one ticket per message. Open **Data & Privacy → Agent activity** to review each agent separately, enable owned setup, run a no-ticket safe test, request current-work coverage, pause, reconnect, remove, or clear nonessential event history.

## Windows x64 compatibility

Support claims are pinned to exact independently checked versions. Detection, manual reporting, snapshots, automatic lifecycle events, and automatic terminal evidence are separate capabilities.

| Agent | Qualified Windows version | Detection | Manual/explicit | Current-work snapshot | Automatic events | Automatic terminal | Freshness |
|---|---:|---|---|---|---|---|---|
| Codex CLI | `0.144.3` | Yes | Local command or MCP | Next safe hook interaction; no history scan | Partial: session, turn/tool, permission, stop | No general automatic terminal; explicit local/MCP complete, fail, or cancel | “Recently observed” for 15 minutes; no heartbeat claim |
| Claude Code | `2.1.207` | Yes | Local command or MCP | Next safe hook/task interaction; no history scan | Partial: session, turn, notification, failure | `TaskCompleted` only for Claude task identity; general sessions require explicit terminal evidence | “Recently observed” for 15 minutes; no heartbeat claim |
| Pi | `0.80.3` | Yes | Extension command/tool or local command | Current resident extension session | Partial: session/agent/settled plus 45-second heartbeat | Explicit extension command/tool only | Current for 120 seconds while the resident extension reports |

An installed version outside the exact qualified cell is detection/manual only until separately verified. On the 2026-07-14 Windows acceptance host, Pi `0.80.7` was detected but intentionally remained unsupported for automatic events because only `0.80.3` is qualified. Claude Code `2.1.207` was detected, authenticated, and its owned setup/rollback passed; its shared local hook path delivered privacy-minimized activity, but the controlled real-current-work CLI cell remained unavailable because Anthropic returned HTTP 429. Codex `0.144.3` completed the real packaged-helper current-work path.

FindMnemo reports three separate facts: the agent account state, the FindMnemo connection credential, and owned-hook/extension trust. A valid FindMnemo credential never makes a signed-out agent appear authenticated. Pi activity does not require a separately detectable Pi account login, so its agent-account state is **Not applicable** rather than authenticated or signed out. Hook trust becomes verified only after FindMnemo receives a privacy-minimized event through its owned setup; it is never inferred from credentials or private agent data.

Codex command hooks require review and trust before normal use. FindMnemo never changes that trust decision. The acceptance harness uses Codex’s documented one-off bypass only after verifying the exact FindMnemo-owned hook definition, and records that persistent review is still required. Claude user hooks and Pi global extensions retain their clients’ own trust/security behavior. See the first-party [Codex hooks](https://developers.openai.com/codex/hooks), [Claude Code hooks](https://code.claude.com/docs/en/hooks), and [Pi extensions](https://pi.dev/docs/latest/extensions) references.

## What setup installs

- Codex: owned entries in `~/.codex/hooks.json` for safe lifecycle events.
- Claude Code: owned entries in `~/.claude/settings.json` for safe lifecycle and task events.
- Pi: one owned `~/.pi/agent/extensions/findmnemo-activity.ts` extension.

The installed Windows package invokes its own signed-or-preview executable with `--activity-hook`; source development invokes the compiled local helper. Neither command contains an activity token. Tokens and bounded offline retry records use the operating-system-protected local secret store. Removal deletes only FindMnemo-owned entries, tokens, retry data, and temporary backups while preserving tickets, assignments, project folders, SDD links, completion evidence, and unrelated agent configuration.

## Exact privacy boundary

The helper accepts the agent hook object in memory and allowlists only an opaque session/task ID, event kind, time, safe model/tool label, explicit terminal evidence, and reviewed project reference. It drops unknown fields and never opens paths exposed by a hook.

FindMnemo does not store or transmit prompts, responses, reasoning, transcripts, credentials, raw logs, file contents, tool inputs/results, task descriptions, or transcript paths. The browser cannot call reporter ingress, read activity tokens/retry records, install hooks, inspect arbitrary local files, or access the operational database. It receives only normalized assignment, coverage, snapshot, review, and management receipts through the paired companion API. The public Sample workspace cannot connect to agent activity or read operational records.

Silence, inactivity, process exit, window closure, Codex/Claude `Stop`, Claude `SessionEnd`, Pi `agent_settled`, and Pi `session_shutdown` never mean completed. Stale retains the last successful state and timestamp. Completion, failure, and cancellation require matching explicit terminal evidence.

## Recovery and limitations

- If the companion is offline, the already-sanitized event is placed in a bounded protected retry spool. Replay preserves assignment identity and sequence rules.
- Codex and Claude snapshots begin at the next safe event. Zero observed assignments means only that none were observed in that coverage window.
- Pi can report only the current resident extension session; it does not enumerate stored sessions.
- Unsupported agent versions do not expose snapshot controls. In particular, detected Pi `0.80.7` remains manual-only and cannot request the `0.80.3` current-session snapshot.
- Manual recovery shows the local `report:activity` command and MCP reporting path. It does not run the validation-only safe test or claim that automatic setup is healthy.
- Project ambiguity remains Unassigned/needs review. Multiple folders must be explicitly reviewed; no drive-wide scan occurs.
- Full non-Windows agent-activity certification and paid Authenticode signing remain deferred. The Windows directory/installer produced by this repository is an unsigned preview unless separately signed and timestamped.

Run the local release gate after packaging:

```powershell
npm run package:desktop:dir
npm run verify:agent-activity-windows
```

The machine-specific JSON evidence is written under ignored `release-desktop/`; it is not a public artifact and contains no local paths, identities, hook payloads, credentials, or agent output.
