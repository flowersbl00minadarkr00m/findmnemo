# Spec 006 Windows Tokscale acceptance

Date: 2026-07-13  
Platform: Windows  
Tokscale: 4.5.2  
Collector: embedded FindMnemo asset (`@tokscale/cli` 4.5.2)  
Adapter: `tokscale-v4.4-v4.5`  
Qualified versions: 4.4.1 or 4.5.2

This record contains only sanitized counts, stable recipe names, timings, byte sizes, and safe states. No real Tokscale JSON, model/client labels, paths, accounts, prompts, responses, transcripts, credentials, session/workspace labels, or raw logs are retained here.

## Controlled companion run

The acceptance harness started a current production-built companion on an ephemeral loopback port with a temporary database. It established a local paired session, ran a cancellable refresh, ran a complete seven-day collection, queried retained data without rescanning, generated a JSON export, compared routing policy before/after, scanned browser/persisted/log/export boundaries, stopped the companion, and deleted the temporary database and graph directory.

| Stable recipe | State | Duration | JSON bytes | Adapted records |
| --- | --- | ---: | ---: | ---: |
| version | complete | bounded by 5,000 ms | not retained | capability only |
| clients | complete | 664 ms | 12,420 | 39 source states |
| canonical-graph | complete | 359 ms | 10,425 | 18 canonical daily records |
| session-attribution | complete | 129 ms | 24,178 | 41 non-additive opaque records |
| workspace-attribution | complete | 131 ms | 7,115 | 11 non-additive opaque records |

The normalized JSON export was 138,602 bytes. The refresh state was **partial**, correctly, because not every client Tokscale knows about had an available local source. Partial coverage did not discard the 18 usable canonical records or 52 attribution records.

## Acceptance results

- Real supported Windows refresh through the companion: passed.
- Global Tokscale excluded from PATH: passed for both the source dependency and packaged-only companion paths.
- Deterministic collector selection: passed; the embedded collector won without consulting ambient PATH, and only an explicit absolute recovery path may be considered when the embedded asset is unavailable.
- Packaged Windows asset: exactly one `tokscale/tokscale.exe` (20,327,424 bytes), with zero other platform collector assets.
- Tokscale MIT attribution: present in the packaged third-party notices.
- Separate Tokscale install: not required for the ordinary Windows path; runtime package-manager installation is prohibited by the release boundary check.
- Explicit-home recipes: passed.
- Immediate cancellation and Windows process-tree termination: passed (`cancelled`).
- Exclusive graph temp-file cleanup: passed.
- Retained query/export without rescan: passed.
- Browser-visible DTO, export, companion log, temporary database lifecycle, and path/account/prohibited-field canaries: passed.
- Routing policy before/after usage operations: byte-equivalent.
- Forbidden login, account, quota, submit, autosubmit, leaderboard/social, and scheduler operations: absent from the command allowlist.
- Tokscale 4.4.1 and 4.5.2 sanitized fixtures: passed. Versions between or outside those exact versions remain unsupported.

The companion itself issued no pricing/account/social request. Child-process socket inspection was not instrumented, so this record does not claim that Tokscale itself opened no network connection. No Tokscale or provider credential was supplied to the child process.

## Verification limitation

The packaged artifact above was built and inspected successfully, and a packaged-only companion completed the real refresh. On this workstation, stock Electron Builder's dependency-collection step previously hung while invoking Windows PowerShell. A temporary change inside the ignored installed Electron Builder dependency was used only to complete that packaging run and was restored immediately afterward; no workaround was committed to FindMnemo. Windows PowerShell and DPAPI subsequently recovered, and a fresh integrated retry passed 59 test files / 281 tests, every project boundary, lint, source/companion builds, source lifecycle verification, and the desktop build.

The sanitized development fixture passed manual semantic-navigation, responsive-layout, explicit-fictional-labeling, and Sample-isolation checks. Henry then completed the permissioned live operational walkthrough at the canonical `127.0.0.1:3210` endpoint: the companion connected successfully and **Refresh usage** pulled operational usage data while preserving partial-coverage disclosure. A final post-walkthrough `npm run verify:ci`, `npm run build:desktop`, and `npm run check:desktop-boundary` pass completed the acceptance evidence.

Re-run after a production build with:

```text
npm run verify:tokscale-windows
node scripts/verify-tokscale-package.mjs
```
