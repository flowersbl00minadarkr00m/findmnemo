# Tokscale compatibility

FindMnemo uses Tokscale only as a local collection and aggregation command. Tokscale 4.5.2 is built into the Windows x64 package and installed as a locked platform dependency for source runs, so ordinary users do not install a global Tokscale command. The companion runs a closed set of documented JSON recipes without a shell and converts their output into FindMnemo's normalized usage records.

## Qualified versions

| Tokscale version | FindMnemo state | Evidence |
| --- | --- | --- |
| 4.4.1 | Supported | Version-labelled sanitized graph, clients, session, and workspace fixtures and adapter contract tests |
| 4.5.2 | Supported | The same fixture suite plus a real Windows companion acceptance run |
| Any other version | Unsupported | Fails closed; the previous successful snapshot remains available |

This is deliberately an exact-version list, not a continuous `4.x` range. A new Tokscale release is unsupported until its documented JSON contract passes sanitized fixtures and controlled Windows verification.

## Stable recipes

FindMnemo internally names the allowed operations `version`, `clients`, `canonical-graph`, `session-attribution`, and `workspace-attribution`. They resolve to Tokscale's version check, `clients --json`, graph JSON export, and models JSON grouped by `client,session,model` or `workspace,model`. An explicit local home is supplied to every collection command.

FindMnemo never invokes Tokscale login, logout, whoami, submit, autosubmit, leaderboard/social, provider quota, account integration, or credential commands. It never installs or upgrades Tokscale at application runtime. If the embedded collector is missing or damaged, repair/reinstall the matching FindMnemo release. An absolute `FINDMNEMO_TOKSCALE_EXTERNAL_PATH` is available only as an explicit local developer/support fallback after embedded candidates are unavailable.

## Collector packaging

- Windows 11 x64 packages contain only `tokscale/tokscale.exe` for `@tokscale/cli-win32-x64-msvc` 4.5.2 plus FindMnemo's complete third-party notice.
- Source runs resolve the matching optional platform package installed by locked `npm ci`; ambient PATH cannot override it.
- macOS and Ubuntu collector packages are available through the source-run dependency, but their broader FindMnemo/Gmail support claims remain governed by the experimental platform matrix.
- Other versions, missing native packages, wrong architectures, malformed output, or damaged executables fail closed and preserve the last successful normalized snapshot.
- The collector path never enters browser DTOs, logs, diagnostics, exports, or persisted usage evidence.

## Limits and failure behavior

- A missing source is shown as unavailable; it is not converted to zero usage.
- If any source is unavailable or reports diagnostics, coverage is partial even when the usable sources were imported successfully.
- Schema changes, malformed JSON, unsupported versions, timeouts, output ceilings, and missing output fail clearly. A failed refresh does not replace prior successful evidence.
- Session and workspace attribution is non-additive. It is stored with opaque local identities and is never summed into canonical daily totals.
- FindMnemo does not claim that Tokscale's estimated cost is provider billing or subscription quota data.
- The companion does not issue network requests for pricing, accounts, or social features. The acceptance harness does not instrument sockets opened internally by the Tokscale process, so it makes no broader claim about Tokscale's own networking.

The current measured Windows evidence is in [Spec 006 Windows acceptance](../../release-evidence/spec-006-windows-tokscale.md).
