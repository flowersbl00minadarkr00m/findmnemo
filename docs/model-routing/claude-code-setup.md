# Claude Code Chat-Native Routing Setup

FindMnemo was checked with Claude Code 2.1.198 on Windows. It reuses the same STDIO MCP server, companion-owned policy, protected local routing credential, and dispatch lifecycle as Codex; only the receipt origin label changes to `claude-code-mcp`.

Choose the trust scope yourself. A user-scoped server is convenient across projects; a local-scoped server keeps the choice private to one project. Do not commit the routing credential or a private machine path in `.mcp.json`. Claude Code requires trust verification for new MCP servers and lets you control MCP tool permissions.

After building FindMnemo and starting the companion, add the server with the scope you approve. Use an absolute local path in your actual command:

```text
claude mcp add --scope user findmnemo-routing -- node C:\path\to\findmnemo\dist-companion\server\mcp\findmnemo-mcp.js --origin=claude-code-mcp
```

Use `claude mcp get findmnemo-routing` or `claude mcp list` to inspect status. Review the server before approving it. Do not use `claude mcp login`; FindMnemo uses its OS-protected local companion credential, not Claude authentication or remote OAuth.

The active MCP tool result is the same-conversation return channel. Permission denial, disconnect, timeout, cancellation, and an expired return channel remain distinct failures; FindMnemo does not silently retry or inject unsolicited output after the call/session has gone away. Output and task text are not persisted in receipts or browser DTOs.

Primary compatibility references: [Anthropic MCP setup and scopes](https://docs.anthropic.com/en/docs/claude-code/mcp), [Claude Code security and MCP trust](https://docs.anthropic.com/en/docs/claude-code/security), and [Claude Code settings locations](https://docs.anthropic.com/en/docs/claude-code/settings).

To disable or uninstall the user-scoped origin without deleting policy or receipts, run `claude mcp remove findmnemo-routing -s user`. See [setup, privacy, troubleshooting, and rollback](setup-and-privacy.md).
