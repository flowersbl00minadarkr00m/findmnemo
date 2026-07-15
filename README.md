# FindMnemo

FindMnemo is MIT-licensed local-first software. macOS/Linux users can follow the zero-cost [source-run guide](docs/source-run.md); Windows users can build from source or use the separately labeled [unsigned preview](docs/unsigned-windows-preview.md). Platform claims are listed in [docs/platform-support.md](docs/platform-support.md).

The hosted interface is available at [findmnemo.vercel.app](https://findmnemo.vercel.app). The previous `mnemosync.vercel.app` address remains a compatibility fallback.

FindMnemo is a local-private operations workspace for tracking work across Pi, Codex, and Claude Code. It combines ticket management, SDD progress, Gmail follow-up triage, model-routing preferences, privacy-minimized active assignments, and source reconciliation without treating simulated or stale data as live evidence.

## Workspaces

- `/` offers a choice between the operational and Sample workspaces.
- `/demo` is a fictional, session-only Sample workspace. It never contacts Gmail, Supabase, the companion, or local operational sources.
- `/app` is the operational workspace. It requires the authenticated companion and uses the companion-owned SQLite database.
- `http://127.0.0.1:3210/app` is the local fallback and uses the same companion and database as the hosted operational workspace.

There is no Demo/Live toggle. The route defines the workspace boundary.

## Architecture

- React 19, TypeScript, Vite 8, and Tailwind CSS v4 provide the browser UI.
- A Node 24 companion binds only to `127.0.0.1:3210`.
- Exact-origin checks, one-time pairing, nonce-bound rotating sessions, and protocol validation protect private APIs.
- SQLite under the OS-conventional FindMnemo data root stores operational tickets, email metadata, configured sources, reconciliation runs, and minimized audit records.
- Gmail uses Google Desktop OAuth with PKCE and the `gmail.metadata` scope.
- Refresh credentials are protected with Windows DPAPI `CurrentUser`, macOS Keychain, or Linux Secret Service; access credentials remain in companion memory.
- FindMnemo reconciles configured sources. It does not assign work to agents or claim a handoff occurred.
- Explicitly enabled Codex, Claude Code, and Pi integrations report only allowlisted assignment lifecycle metadata through the installed companion. Unsupported versions remain manual/unobserved; no transcript, prompt, response, reasoning, credential, raw log, path, or file content is captured.

## Quick Start

```text
npm ci
npm run setup:check
npm run build:source
npm run verify:source
npm run start:companion
```

Open `http://127.0.0.1:3210/app` for the local operational surface. For frontend development, run `npm run dev` in a second shell.

For chat-native model routing, open **Engines**, choose **Check this computer**, explicitly turn on a checked connection, select an exact model and effort, then assign that route to one kind of work. Qualified destinations are Pi, Codex CLI, Claude Code CLI, loopback Ollama, and locally authorized OpenRouter; each retains its own catalog, authentication, and readiness evidence. Add the local MCP server to [Codex](docs/model-routing/codex-setup.md) and/or [Claude Code](docs/model-routing/claude-code-setup.md) so a task can be dispatched and returned in the originating chat. Detection never enables a connection or sends work.

For privacy-minimized active-work tickets from Codex, Claude Code, and Pi, use the installed companion’s **Data & Privacy → Agent activity** controls and review the exact [Windows compatibility, setup, snapshot, lifecycle, and privacy boundary](docs/agent-activity.md). Detection, manual reporting, snapshots, partial automatic events, and explicit terminal evidence are reported separately; unsupported versions retain a manual fallback.

External Codex, Claude, and Pi sessions need a local bridge or browser automation before their tickets count as live agent-created work. The hosted interface alone cannot observe private desktop sessions.

For local model-usage analytics, open **Metrics**, choose **Model Usage**, and refresh manually. The Windows package includes the exact [qualified Tokscale collector](docs/compatibility/tokscale.md); locked source installs receive the matching platform dependency, so no separate global Tokscale installation is required. FindMnemo normalizes the local result without sending raw logs, prompts, responses, credentials, paths, or readable session/workspace identities to the browser. See the [navigation guide](docs/navigation.md), [model-usage guide](docs/model-usage.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

Use **Data & Privacy** to preview and download companion-owned data or safely add supported records from a FindMnemo bundle. See the [data portability guide](docs/data-privacy.md) for category, import, and privacy boundaries.

On first connection, FindMnemo explains each optional source before reading it. You may connect Gmail, one or several project folders, registered agent activity, or local model usage—or continue with tickets only. Project folders do not need SDD. Folder paths remain in the installed/local process; the browser receives only private IDs, labels, detected type, and freshness. See [source setup](docs/source-onboarding.md).

On this machine, ensure development dependencies are included and `NODE_ENV` is not globally forced to `production` before starting Vite.

## Gmail Setup

Create a Google OAuth client with application type **Desktop app**, add the approved test user while the consent screen is in testing, and set the local environment variables. Windows PowerShell example:

```powershell
[Environment]::SetEnvironmentVariable('FINDMNEMO_GOOGLE_CLIENT_ID', 'your-client-id.apps.googleusercontent.com', 'User')
[Environment]::SetEnvironmentVariable('FINDMNEMO_GOOGLE_CLIENT_SECRET', 'your-desktop-client-secret', 'User')
```

Start a new shell after setting user variables, rebuild/restart the companion, then use the Gmail connection control in `/app`. Do not put OAuth values in source control, browser storage, Vercel, Supabase, logs, or exported diagnostics.

Existing `gmcli` credentials are not imported. See [docs/gmail-setup.md](docs/gmail-setup.md) for the complete flow.

## Diagnostics

```powershell
npm run companion:doctor
npm run verify:chat-routing
```

Doctor verifies loopback listener ownership and identity, protocol compatibility, database integrity, OAuth client configuration presence, secure credential-store capability, and browser guidance. It reports evidence-backed codes; a generic fetch failure remains an unknown `error` until diagnostics identify a cause.

See [docs/browser-support.md](docs/browser-support.md) for the tested Edge/Chrome versions and recovery decision tree.

## Verification

```powershell
npm test -- --run
npm run check:ontology
npm run check:observed-work
npm run check:workflow
npm run check:routing
npm run check:local-private
npm run check:public-release
npm run check:desktop-boundary
npm run lint
npm run build
npm run build:companion
npm run companion:doctor
```

## Privacy Boundary

- Gmail MIME bodies, credentials, raw local ledgers, and browser pairing/session tokens are prohibited from logs, diagnostics, telemetry, and hosted storage.
- Agent activity excludes prompts, responses, reasoning, transcripts, credentials, raw logs, private paths, and file contents; only bounded allowlisted assignment metadata may be retained locally.
- Gmail candidates retain only approved headers, a bounded snippet, reason codes, timestamps, and a Gmail-open reference.
- Operational state remains local to the companion. Supabase is used only for separately approved minimized telemetry/receipt workflows.
- Sample records never migrate into the operational database.

## Deployment

The hosted client may be deployed to Vercel only after a compatible companion build is available. Production CSP and connection rules target the fixed loopback endpoint. The hosted client does not receive Gmail credentials or operational email data. The preferred production URL is `https://findmnemo.vercel.app`; `https://mnemosync.vercel.app` remains a legacy alias.

Set `VITE_LOCAL_COMPANION_ENABLED=false` and redeploy to disable the hosted operational entry during rollback. This flag does not delete the companion SQLite database or revoke Gmail; only the explicit Disconnect action revokes the credential. The local fallback remains available.

Release and rollback evidence is maintained in [docs/acceptance-evidence.md](docs/acceptance-evidence.md) and [docs/build-status.md](docs/build-status.md).
