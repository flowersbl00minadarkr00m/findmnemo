# Unsigned Windows preview

The current Windows NSIS artifact is an **Unsigned preview**, not a trusted production installer. It costs nothing to build, but Windows may show SmartScreen or unknown-publisher warnings because no protected Authenticode identity is attached.

## Current availability

There is not yet a downloadable FindMnemo binary in GitHub Releases. The hosted `/app` page cannot install or start software on your computer. Until a signed release is published, use one of these local paths from a cloned FindMnemo repository.

### Run the companion from source

Install Node.js 24 LTS and Git, then run in PowerShell:

```powershell
npm ci
npm run setup:check
npm run build:source
npm run verify:source
npm run start:companion
```

Keep the terminal open and visit `http://127.0.0.1:3210/app`. This is a foreground source run, not an installed desktop application.

### Build and install the desktop preview

```powershell
npm ci
npm run package:desktop
```

Run `release-desktop\FindMnemo-Companion-0.1.0-x64.exe`. The installer is per-user, x64, does not require administrator access, and installs the local companion and desktop controls. Node.js and the source checkout are needed to build it, but not for ordinary use after installation.

Do not download an installer from an unofficial location. A future public release must include the intended tag, SHA-256 checksum, and provenance before this guide presents it as downloadable.

## Safety checks

- Verify the artifact came from the intended tagged source revision.
- Compare its published SHA-256 checksum and build-provenance record before running it.
- Review SmartScreen details for the exact filename/publisher state. Do not disable SmartScreen, antivirus, UAC, or other global security controls.
- Installation is per-user and no-admin. Operational data remains under `%LOCALAPPDATA%\FindMnemo`.

The Microsoft Store is a later, lowest-priority trusted Windows channel. Store packaging, submission, identity, fees, and approval are not part of this source-run feature. See [windows-companion.md](windows-companion.md) for lifecycle behavior.
