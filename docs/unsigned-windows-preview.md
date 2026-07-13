# Unsigned Windows preview

The current Windows NSIS artifact is an **Unsigned preview**, not a trusted production installer. It costs nothing to build, but Windows may show SmartScreen or unknown-publisher warnings because no protected Authenticode identity is attached.

- Verify the artifact came from the intended tagged source revision.
- Compare its published SHA-256 checksum and build-provenance record before running it.
- Review SmartScreen details for the exact filename/publisher state. Do not disable SmartScreen, antivirus, UAC, or other global security controls.
- Installation is per-user and no-admin. Operational data remains under `%LOCALAPPDATA%\FindMnemo`.

The Microsoft Store is a later, lowest-priority trusted Windows channel. Store packaging, submission, identity, fees, and approval are not part of this source-run feature. See [windows-companion.md](windows-companion.md) for lifecycle behavior.
