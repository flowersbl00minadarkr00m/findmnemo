# Model Routing Setup, Privacy, Troubleshooting, and Rollback

## Plain-language setup

1. Build and start the local companion: `npm run build:source`, then `npm run start:companion`.
2. Open `/app`, choose **Model Routing**, and stay in **Guided**.
3. Choose **Check tools**. Detection reads safe local metadata; it installs nothing, signs into nothing, and enables nothing.
4. Choose Pi, a provider, an exact model, an effort level, and one or more kinds of work such as Writing.
5. Explicitly choose whether the profile is enabled and whether it only recommends or may delegate on a clear exact match.
6. Save the profile, then choose **Check exact connection**. Automatic delegation remains blocked unless the evidence is ready and fresh.
7. Add the local MCP server to Codex and/or Claude Code using their setup guides. Restart an already-open client if it does not discover the newly added server.
8. Run `npm run verify:chat-routing` before relying on the integration after upgrades.

Advanced retains the approved Spec 004 route registry, capabilities, backup orders, specialized orders, recommendation, import, and export controls. The Sample workspace is fictional and cannot detect, validate, migrate, dispatch, or read operational receipts.

## What crosses each boundary

- Origin chat to local MCP/companion: the current task text, normalized capability IDs, explicit overrides, correlation, and idempotency metadata. This exists locally for the active call.
- Companion to Pi: the task and the exact selected provider/model/effort through an isolated no-session/no-tools RPC process.
- Companion to browser: normalized policy, safe tool/version/catalog/readiness metadata, and content-free dispatch receipts.
- Persisted receipt: origin label, capability basis, policy version, requested/actual route, timestamps, state, hashes, and bounded failure code.

Provider credentials remain in Pi/provider-supported storage. The browser never receives provider credentials, prompts, results, raw CLI output, environment values, private executable paths, or conversation transcripts. Prompts and results are not persisted in routing receipts. A completed result may be temporarily recoverable only while the same companion process retains it in bounded memory.

## Troubleshooting

- **Pi not found:** install Pi yourself, restart the companion, and check tools again. FindMnemo never runs installers.
- **Unsupported Pi:** use the compatibility matrix's qualified range or leave the tool recommendation-only.
- **Authentication required:** authenticate the provider inside Pi. Do not paste provider keys into FindMnemo.
- **Model or effort unavailable:** refresh the catalog and choose an exact listed combination.
- **Stale connection:** choose **Check exact connection** again. Stale evidence cannot auto-dispatch.
- **MCP missing in chat:** verify `codex mcp get findmnemo-routing` or `claude mcp get findmnemo-routing`, then restart that client.
- **Decision required:** confirm the work type, select an exact destination explicitly, or handle it yourself. FindMnemo never auto-runs a partial match.
- **Return unavailable:** the destination may have completed after the origin call disappeared. History shows the receipt but not result content. Retry in the originating chat if bounded companion-memory retry is no longer available.
- **Actual route mismatch:** treat the dispatch as failed and review Pi/catalog state. FindMnemo does not relabel a mismatch as success.

## Disable, rollback, and uninstall

Disable chat dispatch without deleting local policy or receipts:

```powershell
codex mcp remove findmnemo-routing
claude mcp remove findmnemo-routing -s user
```

You can also turn every profile off or set behavior to **Recommend it and ask me**. For a hosted UI rollback, set `VITE_LOCAL_COMPANION_ENABLED=false` and redeploy; this does not delete the local database or revoke Gmail/provider credentials. Stop the companion to end all local routing processes. Uninstalling the MCP entries removes only origin registration; exports and content-free receipts remain readable in FindMnemo.
