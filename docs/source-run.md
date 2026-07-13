# Build and run FindMnemo from source

This is the zero-cost macOS/Linux distribution path. It runs the existing browser UI and local loopback companion; it is not a native installer or background daemon.

## 1. Prerequisites

- Node.js 24 LTS and npm from the same installation.
- Git and a terminal.
- macOS 13.5+ on arm64/x64, or Ubuntu 24.04 desktop on x64/arm64 for the intended support rows. These rows remain **experimental until clean-host acceptance is published**.
- For Gmail: a Google Desktop OAuth client plus an available macOS Keychain or unlocked Linux Secret Service provider. Headless Linux, WSL, and musl are not full-Gmail-parity targets.

## 2. Configure locally

Copy `.env.example` to `.env` and add only local values. Never commit `.env`.

```bash
export FINDMNEMO_GOOGLE_CLIENT_ID='your-desktop-client-id.apps.googleusercontent.com'
# Set only when the Desktop OAuth client actually has a secret.
export FINDMNEMO_GOOGLE_CLIENT_SECRET='your-desktop-client-secret'
```

Credentials stay in the OS credential store. Operational data stays outside the checkout at:

- macOS: `~/Library/Application Support/FindMnemo`
- Linux: `$XDG_DATA_HOME/FindMnemo` or `~/.local/share/FindMnemo`

## 3. Install, preflight, build, and verify

```bash
npm ci
npm run setup:check
npm run build:source
npm run verify:source
```

Preflight is non-destructive: it does not install packages, create the operational database, terminate processes, or retain its random keyring probe. `verify:source` uses an isolated temporary database and deletes it after a bounded start/restart/stop check.

## 4. Run in the foreground

```bash
npm run start:companion
```

Open `http://127.0.0.1:3210/app`. Keep the terminal open. `Ctrl+C` or `SIGTERM` drains the listener/logger and closes SQLite. FindMnemo does not install a launch agent, systemd unit, login item, or daemon.

Expected safe output includes the loopback URL, a one-time local pairing code, and stable diagnostic codes. It must not include credentials, environment dumps, Gmail content, account identity, prompts/responses, or absolute data paths.

## 5. Update without moving data

1. Stop the companion cleanly.
2. Record the current known-good Git revision.
3. Fetch and check out the intended tagged revision.
4. Run `npm ci`, `npm run setup:check`, `npm run build:source`, and `npm run verify:source`.
5. Start the companion. The stable platform data root is reused; build outputs are disposable.

Schema-affecting startup retains the existing pre-migration backup behavior. Never copy the operational database into the checkout.

## 6. Recovery and rollback

- `NODE_VERSION_UNSUPPORTED`: install Node 24 LTS.
- `DEPENDENCY_LOCK_MISMATCH`: restore the committed package/lock pair and rerun `npm ci`.
- `DATA_ROOT_UNAVAILABLE`: restore user-level filesystem access or use an explicit absolute isolated path.
- `CREDENTIAL_PERMISSION_REQUIRED` / `CREDENTIAL_STORE_UNAVAILABLE`: approve, configure, or unlock the OS keyring; Gmail stays disconnected meanwhile.
- `COMPANION_ALREADY_RUNNING`: use the verified existing instance or stop it cleanly.
- `PORT_IN_USE`: identify and stop the unknown owner yourself; FindMnemo never kills it.

For revision rollback, stop FindMnemo, check out the prior known-good tag, reinstall from its lock, rebuild, and verify. If that runtime rejects a newer database schema, do not force it; move forward or restore a verified compatible backup.
