# Model Routing Setup, Privacy, Troubleshooting, and Rollback

## Plain-language setup

1. Build and start the local companion: `npm run build:source`, then `npm run start:companion`.
2. Open `/app`, choose **Engines**, then choose **Check this computer**. Detection reads safe local metadata; it installs nothing, signs into nothing, enables nothing, and sends no work.
3. Check one connection. Sign in with the tool that owns the account when required, then explicitly choose **Turn on**.
4. Choose an exact model and supported effort from that connection's own catalog, name the route, then choose **Check and add route**.
5. Under **Choose who handles each kind of work**, add one primary and optional ordered backups. **Ask first** recommends in chat; **Send automatically** permits an exact, ready route to run without a separate UI approval.
6. Save the assignments. Stale, disabled, signed-out, missing-model, or unsupported routes fail closed.
7. Add the local MCP server to Codex and/or Claude Code using their setup guides. Restart an already-open client if it does not discover the newly added server.
8. Run `npm run verify:chat-routing` after upgrades.

There is one primary assignment surface. Inactive legacy manual routes can be removed but cannot dispatch. The Sample workspace is fictional and cannot detect, validate, migrate, dispatch, or read operational receipts.

## What crosses each boundary

- Origin chat to local MCP/companion: the current task text, normalized work type, explicit overrides, correlation, and idempotency metadata. This exists locally for the active call.
- Companion to the chosen destination: the task and exact selected model/effort through its bounded local adapter. Codex and Claude use non-interactive CLI modes, Pi uses isolated RPC, Ollama uses fixed loopback, and OpenRouter uses the locally protected account.
- Companion to browser: normalized policy, safe tool/version/catalog/readiness metadata, and content-free dispatch receipts.
- Persisted receipt: origin label, work-type basis, policy version, requested/actual route evidence, timestamps, state, hashes, and a bounded failure code.

Provider credentials remain in tool-owned or operating-system protected storage. The browser never receives provider credentials, prompts, results, raw CLI output, environment values, private executable paths, or conversation transcripts. Prompts and results are not persisted in routing receipts. A completed result may be temporarily recoverable only while the same companion process retains it in bounded memory.

Project context is selected by an opaque approved folder ID. Raw folder paths never enter browser state. With no selected project, routes use an empty local scratch folder.

## Troubleshooting

- **Tool not found:** install it yourself, restart the companion, and check this computer again. FindMnemo never runs installers.
- **Unsupported tool:** use a version in the compatibility matrix or leave that connection off.
- **Authentication required:** sign in inside Codex, Claude, or Pi. For OpenRouter, use the companion-owned authorization flow. Do not paste provider keys into browser fields.
- **Model or effort unavailable:** check the connection again and choose an exact listed combination.
- **Stale connection:** check it again, review the catalog, and explicitly turn it back on. Stale evidence cannot dispatch.
- **MCP missing in chat:** verify `codex mcp get findmnemo-routing` or `claude mcp get findmnemo-routing`, then restart that client.
- **Decision required:** an **Ask first** assignment recommends the ready route; explicitly approve it in the originating chat or handle it yourself.
- **Return unavailable:** history retains the content-free receipt, not the result. Retry in the originating chat if bounded companion-memory recovery is no longer available.
- **Actual route unknown:** FindMnemo labels unproved destination fields requested-unverified or null; it does not infer them.

## Disable, rollback, and uninstall

Disable chat dispatch without deleting local policy or receipts:

```powershell
codex mcp remove findmnemo-routing
claude mcp remove findmnemo-routing -s user
```

You can also turn every connection off or set assignments to **Ask first**. For a hosted UI rollback, set `VITE_LOCAL_COMPANION_ENABLED=false` and redeploy; this does not delete the local database or revoke Gmail/provider credentials. Stop the companion to end all local routing processes. Uninstalling MCP entries removes only origin registration; exports and content-free receipts remain readable.
