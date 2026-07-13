# Model Routing Compatibility

This matrix describes what FindMnemo has actually qualified. Finding a command does not enable it, authenticate it, or prove it can receive work.

| Tool | Tested version/range | Detection | Catalog | Readiness | Dispatch |
|---|---:|---|---|---|---|
| Pi | 0.80.3 / 0.x | Qualified on Windows | Qualified through strict JSONL RPC | Exact provider, model, and effort; expires after 15 minutes | Qualified on Windows with one isolated no-session/no-tools process per dispatch |
| Codex CLI | 0.142.2, origin only | Command/version metadata | Not applicable | Current companion policy/readiness | Qualified as a local STDIO MCP origin; it does not execute as a destination |
| Claude Code | 2.1.198, origin only | Command/version metadata | Not applicable | Current companion policy/readiness | Qualified as a local STDIO MCP origin; it does not execute as a destination |
| Gemini CLI | Any version, detection-only | Command/version metadata only | Not qualified | Not qualified | Not qualified |
| Ollama | Any version, detection-only | Command/version metadata only | Models may appear through Pi, but direct Ollama control is not qualified | Not qualified | Not qualified |

## Origin compatibility

| Origin | Tested version | Transport | Same-call result | Notes |
|---|---:|---|---|---|
| Codex | 0.142.2 | STDIO MCP | Qualified with integrated fake-backed release harness | Global local server enabled; stable four-tool server; current policy read per call |
| Claude Code | 2.1.198 | STDIO MCP | Qualified with Claude-compatible harness | Same server/policy/credential; distinct `claude-code-mcp` attribution; user-approved trust scope required |

Pi catalog and validation use an isolated, no-session, no-tools, offline-start RPC process. The companion asks only for configured model metadata. It does not submit a prompt, run sign-in, install software, read provider credentials into browser code, or claim provider quota/billing health.

The browser receives only adapter/version labels, normalized provider/model identifiers, supported effort labels, stable reason codes, and `checkedAt`/`expiresAt` timestamps. Executable paths, environment values, raw stdout/stderr, provider keys, Pi session identifiers, base URLs, and raw model pricing records stay out of the browser contract and persistence.

Readiness belongs to each execution profile. Two profiles may use different Pi provider/model/effort selections and retain independent readiness evidence. A catalog or readiness result that is expired, malformed, unsupported, authentication-empty, or missing the exact selection cannot be represented as ready.

Execution smoke evidence: a no-cost OpenRouter `:free` model was selected through Pi 0.80.3, read back as the exact requested provider/model/high effort, and returned the expected bounded response in the same process call. A local Ollama profile with no installed model failed closed and returned no result, confirming that catalog visibility is not treated as execution success. The smoke output itself was not persisted.

Release harness evidence: `npm run verify:chat-routing` exercises the built companion modules with Codex- and Claude Code-attributed MCP calls, an exact fake destination, same-call attribution, delivery acknowledgement, duplicate suppression, explicit self handling, receipt history, and database canary scans. It also requires the qualified Windows `codex`, `claude`, and `pi` commands to report versions. This deterministic harness complements—but does not exaggerate—the separate real no-cost Pi smoke.
