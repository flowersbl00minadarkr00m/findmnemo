# FindMnemo

A local-first operations console for working with AI agents: tickets, agent activity, Gmail follow-ups, and model routing in one workspace — with the data kept on your machine.

[**Live sample workspace**](https://findmnemo.vercel.app/demo) · [Windows local install](docs/unsigned-windows-preview.md) · [Docs](docs/)

The operational route at `/app` requires the local Windows companion to be installed and running; the hosted interface cannot install or start it. The previous `mnemosync.vercel.app` address remains a compatibility fallback.

[![Source run](https://github.com/flowersbl00minadarkr00m/findmnemo/actions/workflows/source-run.yml/badge.svg)](https://github.com/flowersbl00minadarkr00m/findmnemo/actions/workflows/source-run.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Series context

FindMnemo is the proof object for [*Mo Agents, Mo Problems*](https://henryflowers45.substack.com/p/mo-agents-mo-problems), part of the *Looping in the Human* series.

![FindMnemo operations desk](docs/assets/hero.png)

## Features

- Prioritized ticket queue where every item links to the evidence FindMnemo actually observed
- Privacy-minimized activity reporting from Pi, Codex CLI, and Claude Code (lifecycle metadata only)
- Gmail follow-up triage using the metadata scope — message bodies never enter the system
- Chat-native model routing: dispatch work to Pi, Codex, Claude Code, Ollama, or OpenRouter and get results back in the originating chat
- Local model-usage metrics, refreshed manually, never uploaded
- A companion process that binds only to `127.0.0.1`, storing everything in local SQLite

## Quick start on Windows

FindMnemo does not currently publish a downloadable installer in GitHub Releases. To use the operational workspace today, clone this repository and either run the local companion in a terminal or build the unsigned per-user installer yourself.

### Run locally from the checkout

```bash
npm ci
npm run setup:check
npm run build:source
npm run verify:source
npm run start:companion
```

Keep that terminal open and open `http://127.0.0.1:3210/app`. This runs FindMnemo locally but does not install a desktop application.

### Build the Windows desktop installer

```bash
npm ci
npm run package:desktop
```

Run `release-desktop\FindMnemo-Companion-0.1.0-x64.exe`. It is a per-user, no-admin unsigned preview, so review any Windows SmartScreen warning without disabling security controls. See the [Windows install guide](docs/unsigned-windows-preview.md) for the exact limitation.

The hosted `/app` route is only a browser interface: the local companion must already be installed or running. Or try the hosted [sample workspace](https://findmnemo.vercel.app/demo) first (fictional data, browser-only). Full setup: [Gmail setup](docs/gmail-setup.md) · [platform support](docs/platform-support.md).

## How it works

A React front end (hosted or local) pairs with a Node companion on your machine. The companion owns the SQLite database, the Gmail OAuth credential (stored in the OS credential vault), and all source connections; the browser receives only minimized, allowlisted data. The `/demo` route is a fictional sample workspace that never touches operational sources. See the [navigation guide](docs/navigation.md) and [source setup](docs/source-onboarding.md).

External Codex, Claude, and Pi sessions need a local bridge or browser automation before their tickets count as live agent-created work. The hosted interface alone cannot observe private desktop sessions.

## Privacy

- Operational data stays in the companion's local SQLite; nothing operational is hosted.
- Gmail is metadata-scope only — bodies and credentials are barred from logs, telemetry, and the browser.
- Agent activity excludes prompts, transcripts, paths, and file contents; only bounded lifecycle metadata is retained.
- The public browser build has no cloud telemetry writer; receipt decisions and operational records remain local to the companion.

Details: [data portability](docs/data-privacy.md) · [agent activity boundary](docs/agent-activity.md)

## License

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
