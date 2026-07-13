# Spec 008 browser evidence

Verified 2026-07-12 against the sanitized, development-only Sample fixture at `/app?fixture=sample`. The fixture uses the same `SampleWorkspace` as `/demo`, performs no operational fetch, and is removed from production behavior by `import.meta.env.DEV`.

| Viewport | State | Result |
|---|---|---|
| 1440x900 | Operations Desk, adjacent inspector | No document or body horizontal overflow; inspector is adjacent; accessible queue and home-view controls present |
| 1440x900 | Daily Brief | No document horizontal overflow; all three semantic buckets present |
| 768x1024 | Operations Desk and inspector drawer | No main/document horizontal overflow; drawer bounds 12–756px; initial focus on Close |
| 390x844 | Operations Desk | No main/document or queue-region horizontal overflow after repair; long titles truncate within rows |
| 360x800 | Inspector drawer | Drawer bounds 12–348px and 12–788px; Close receives initial focus; Escape dismisses and returns focus to the originating row |

Browser console errors/warnings: none.

## Production bundle review

- Removed the obsolete `Dashboard`, `SyncGraph`, and `DashboardSparkline` modules.
- Daily Brief is lazy-loaded as a 5.12 kB production chunk (1.86 kB gzip).
- Analytics remains intentionally lazy-loaded. Its 405.81 kB chunk (114.60 kB gzip) is dominated by the existing charting dependency and does not affect the primary Operations Desk route.
- The final primary application chunk is 458.53 kB (140.83 kB gzip). Further splitting of the initial Operations Desk/authoritative action path was not justified by this feature's measurements because it would defer the default operational workflow.

## Evidence images

- `spec-008-operations-1440x900.png`
- `spec-008-daily-brief-1440x900.png`
- `spec-008-operations-768x1024.png`
- `spec-008-operations-390x844.png`
- `spec-008-inspector-360x800.png`
