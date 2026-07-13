# Public release audit

> Audited: 2026-07-13
> Scope: integrated public candidate tree and the canonical private Git history
> Publication action: authorized for the sanitized public repository at `flowersbl00minadarkr00m/findmnemo`

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

- macOS and Ubuntu rows remain experimental. Full clean-host keyring, Gmail, lifecycle, update, and recovery certification was explicitly deferred on 2026-07-13.
- The Windows installer remains an unsigned preview. Paid signing and signed-release certification were explicitly deferred on 2026-07-13.
- The canonical private checkout intentionally has no remote. Publication uses the separate sanitized public-repository lineage so its private history is never pushed.

## Local release candidate

A clean single-commit snapshot with generic release identity was created and verified independently from the private working history. Its 225-file source archive and clownfish-branded Windows unsigned-preview checksum/provenance are recorded in `release-evidence/findmnemo-0.1.0-rc.json` and `release-evidence/SHA256SUMS.txt`. The artifacts themselves remain under ignored `release-desktop/`; this is a local candidate, not an external release or a completed cross-platform support claim.
