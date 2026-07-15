# Model Routing Compatibility

This matrix describes what FindMnemo has actually qualified. Finding a command does not enable it, authenticate it, or prove it can receive work.

| Tool | Tested version/range | Detection | Catalog | Readiness | Dispatch |
|---|---:|---|---|---|---|
| Pi | 0.80.3 / 0.x | Qualified on Windows | Qualified through strict JSONL RPC | Exact provider, model, and effort; expires after 15 minutes | Qualified on Windows with one isolated no-session/no-tools process per dispatch |
| Codex CLI | 0.142.2 | Qualified on Windows | Tested manifest for exact supported model/effort choices | Tool-owned sign-in plus fresh connection/profile check | Qualified non-interactive destination; real GPT-5.4/low smoke passed, while actual model/effort remain requested-unverified because CLI output does not prove them |
| Claude Code | 2.1.207 | Qualified on Windows | Tested aliases/custom IDs and effort contract | Tool-owned sign-in plus fresh connection/profile check | Adapter qualified; live execution unverified on this machine because the installed CLI reported signed out |
| Gemini CLI | Any version, detection-only | Command/version metadata only | Not qualified | Not qualified | Not qualified |
| Ollama | 0.31.2 observed | Qualified fixed loopback check | Installed models from literal `127.0.0.1` only | Runtime and model readiness are separate | Direct local dispatch qualified; this machine had an empty inventory, so no model was pulled or executed |
| OpenRouter | Local OAuth/key flow v1 | Companion-owned connection | Live connection-scoped catalog | Local PKCE/OS-protected key and fresh exact profile | Adapter qualified with network fakes; live paid execution remains unverified until a user authorizes an account and intentionally chooses a model |

## Origin compatibility

| Origin | Tested version | Transport | Same-call result | Notes |
|---|---:|---|---|---|
| Codex | 0.142.2 | STDIO MCP | Qualified with integrated fake-backed release harness | Global local server enabled; stable four-tool server; current policy read per call |
| Claude Code | 2.1.198 | STDIO MCP | Qualified with Claude-compatible harness | Same server/policy/credential; distinct `claude-code-mcp` attribution; user-approved trust scope required |

Pi catalog and validation use an isolated, no-session, no-tools, offline-start RPC process. The companion asks only for configured model metadata. It does not submit a prompt, run sign-in, install software, read provider credentials into browser code, or claim provider quota/billing health.

The browser receives only adapter/version labels, normalized provider/model identifiers, supported effort labels, stable reason codes, and `checkedAt`/`expiresAt` timestamps. Executable paths, environment values, raw stdout/stderr, provider keys, Pi session identifiers, base URLs, and raw model pricing records stay out of the browser contract and persistence.

Readiness belongs to each execution profile. Two profiles may use different Pi provider/model/effort selections and retain independent readiness evidence. A catalog or readiness result that is expired, malformed, unsupported, authentication-empty, or missing the exact selection cannot be represented as ready.

Execution smoke evidence includes a no-cost OpenRouter `:free` model through Pi and a bounded real Codex CLI GPT-5.4/low request. A local Ollama connection with no installed model failed closed and returned no result. Claude and direct OpenRouter remain honestly unverified where account authorization was unavailable. Smoke output was not persisted.

Release harness evidence: `npm run verify:chat-routing` exercises the built companion modules with Codex- and Claude Code-attributed MCP calls, an exact fake destination, same-call attribution, delivery acknowledgement, duplicate suppression, explicit self handling, receipt history, and database canary scans. It also requires the qualified Windows `codex`, `claude`, and `pi` commands to report versions. This deterministic harness complements—but does not exaggerate—the separate real no-cost Pi smoke.
