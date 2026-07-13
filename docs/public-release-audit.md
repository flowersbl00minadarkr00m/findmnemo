# Public release audit

> Audited: 2026-07-12
> Scope: local candidate tree and existing four-commit Git history
> Publication action: not performed

## Candidate tree

- MIT license added for FindMnemo source.
- Exact native keyring qualification is recorded under `docs/dependency-qualification/keyring.md`.
- Runtime databases, WAL/SHM files, credentials, keys, logs, backups, support bundles, generated builds/releases/outputs, `.env`, local SDD artifacts, machine-specific acceptance evidence, and the legacy service-role telemetry bridge are excluded by `.gitignore`.
- `check:public-release` enumerates tracked plus unignored files, rejects prohibited artifact types and secret/content markers, and self-tests sanitized-positive and prohibited-negative fixtures.
- Top-level runtime/build dependencies use permissive licenses (MIT, ISC, BSD, or Apache-2.0); no copied keyring source is included. Transitive-license evidence must be regenerated for the eventual tagged release.
- Final Spec 008 screenshots in `docs/screenshots/spec-008-*` contain only the clearly labeled fictional Sample workspace.

## Existing Git history

The existing four commits are **not publication-ready history**. Their author metadata contains a private email address, and an earlier Gmail prototype committed a private account identifier. No credential-shaped secret was found in the focused history scan, but the identity data still violates the public boundary.

Do not publish or mirror the current `.git` history. T8 must create a clean public snapshot/orphan history (or an equivalently sanitized repository export), rerun the public/local privacy scans against that exact candidate, and publish only after explicit external-action authorization. Rewriting the private working repository is neither required nor authorized here.

## Known release limitations

- macOS and Ubuntu rows remain experimental until T8 clean-host keyring, Gmail, lifecycle, update, and recovery evidence passes.
- The Windows installer remains an unsigned preview.
- No Git remote is currently configured, so no external source or release publication occurred.
