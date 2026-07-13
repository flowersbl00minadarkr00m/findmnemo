# Codex Chat-Native Routing Setup

FindMnemo exposes a local STDIO MCP server with four tools: `recommend_route`, `dispatch_work`, `get_dispatch`, and `cancel_dispatch`. The MCP process and companion share a separate routing credential through the operating-system protected secret store. It is not the browser pairing session and it is not a provider key.

Build the companion first with `npm run build:companion`, keep the FindMnemo companion running, and configure Codex to launch:

```text
node C:\path\to\findmnemo\dist-companion\server\mcp\findmnemo-mcp.js
```

Windows CLI setup (replace `$repo` with your local FindMnemo checkout):

```powershell
$repo = "C:\path\to\findmnemo"
codex mcp add findmnemo-routing -- "C:\Program Files\nodejs\node.exe" "$repo\dist-companion\server\mcp\findmnemo-mcp.js"
codex mcp get findmnemo-routing
```

The MCP server reads the current companion-owned policy on every recommendation or dispatch. Editing a model, effort, capability, or behavior in FindMnemo does not require reinstalling or rewriting this integration.

Normal guidance for Codex is: use `recommend_route` before eligible delegated work; use `dispatch_work` only for an exact ready route or an explicit include override; honor `self`, include, and exclude instructions. The result comes back through the same active MCP tool call with requested/actual route attribution. FindMnemo cannot inject an unsolicited result into an inactive or different chat.

MCP instructions improve normal automatic use, but cannot make routing unavoidable in every host turn. You can always call the tools explicitly. Recommendation-only, ambiguous, partial, stale, unsupported, excluded, and unavailable states do not send work.

To disable or uninstall this origin without deleting policy or receipts, run `codex mcp remove findmnemo-routing`. To roll back all chat dispatch, remove/disable the MCP entry in each origin; the companion policy remains readable and exportable. See [setup, privacy, troubleshooting, and rollback](setup-and-privacy.md).
