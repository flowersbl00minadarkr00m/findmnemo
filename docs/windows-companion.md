# FindMnemo Windows Companion

The FindMnemo Companion packages the existing local operational service as a per-user Windows 11 x64 application. Normal installation, first run, daily controls, diagnostics, updates, repair, and uninstall do not require Node.js, npm, a source checkout, a terminal, or administrator rights.

## Privacy boundary

Operational data remains under `%LOCALAPPDATA%\FindMnemo`. The companion owns tickets, Gmail metadata, audit records, local logs, pairing sessions, and the DPAPI-protected Gmail credential. The hosted application receives only the reviewed normalized API records after local pairing. The desktop renderer cannot read credentials, raw email bodies, prompts, responses, environment variables, arbitrary files, or arbitrary URLs.

The control window is bundled local content with Node integration disabled, context isolation and sandboxing enabled, network access denied by CSP, exact sender validation on every IPC command, denied permission requests, and a closed external-target allowlist.

## Install and first run

1. Run the assisted per-user installer.
2. Review the versioned privacy disclosure before the companion starts.
3. Optionally enable start-at-sign-in. It is off by default and can be reversed later.
4. If an existing `%LOCALAPPDATA%\FindMnemo` workspace is found, review the database schema, credential-presence, and listener evidence. Adoption does not move or duplicate the database.
5. If a compatible developer companion is running, close it and retry. FindMnemo never terminates an unknown port owner.

## Daily controls

Closing the window hides it; the tray process and companion continue. The window and tray expose truthful Start, Stop, Restart, hosted app, local workspace, diagnostics, update, and Quit actions. Quit stops the companion. The local workspace remains available without the hosted site or internet access.

## Diagnostics and support bundle

Diagnostics use stable installation, process, listener, database, credential-presence, protocol, startup, and update codes. Checks are bounded and do not change a healthy state. Support export is built only from the previewed allowlist and is scanned again before writing. It excludes credentials, tokens, account/email identity, content, prompts/responses, raw logs, databases, environment variables, command lines, and username-bearing paths.

## Updates and recovery

Packaged builds check the signed HTTPS release channel after health and approximately every six hours. Feed failure leaves the current healthy companion running. A download never activates automatically. The user reviews release notes and permission changes, then explicitly chooses Install and restart. Activation stops local work and backs up the database and lifecycle settings before invoking the NSIS updater.

Production acceptance requires an Authenticode-signed and timestamped installer, executable, update artifact, and immutable manifest. Unsigned development packages are not production releases. Rollback is permitted only to a signed previous runtime that supports the current database schema.

## Repair and existing-state adoption

Re-running the same or newer signed installer repairs application files and registrations while preserving `%LOCALAPPDATA%\FindMnemo`. Adoption is idempotent and stores only a minimized receipt: completion time, database-presence/schema, and credential-presence—not an account identity or credential value. Corrupt or newer databases and unknown listeners block mutation with a safe recovery code.

## Uninstall and retained data

The default Windows Apps uninstall removes the application, startup registration, and update cache but preserves tickets, audit history, settings, logs, and the Gmail credential. The companion UI offers separate plans to remove the Gmail credential or delete all FindMnemo local data. Full deletion requires a second explicit confirmation.

Uninstall plans expire after ten minutes, are integrity-protected and single-use, and fall back to preserve on absence, expiry, tampering, or replay. Recursive deletion is restricted to the resolved `%LOCALAPPDATA%\FindMnemo` root. Reinstall detects retained state and offers adoption; after full deletion it returns to first run.

## Known release limitation

The repository can produce an unsigned development package for verification. A production release remains blocked until the release owner provisions a protected Windows code-signing identity and release-CI access. No unsigned artifact should be presented as the production companion.
