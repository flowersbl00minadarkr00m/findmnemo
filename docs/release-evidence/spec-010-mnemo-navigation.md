# Spec 010 MNEMO navigation acceptance

Date: 2026-07-14  
Surface: local Operational workspace at `127.0.0.1:3210`  
Companion: current production build, restarted after integration

This evidence is sanitized. It records navigation labels, states, dimensions, and check outcomes only; no ticket text, email metadata, credentials, account identifiers, or operational record content is retained.

## Browser acceptance

- The primary sidebar contains exactly **My Day**, **Next Actions**, **Engines**, **Metrics**, and **Outreach** in MNEMO order.
- Collapsed navigation retains full accessible names; expanded navigation shows the plain-language labels, active state, optional counts, and separate Data & Privacy utility.
- My Day preserves the Operations Desk / Daily Brief radio switch.
- Metrics opens Model Usage for a first-time preference and switches to Work Metrics with a checked semantic radio state; the choice is stored only when explicitly selected.
- Searching `Projects/SDD` returns **Go to Next Actions** with the hint that SDD work appears as tickets. The removed Projects/SDD page does not render.
- Data & Privacy replaces the retired Compatibility, observed-work export, Import, and Telemetry header controls.
- The legacy migration panel is absent for excluded-only records; focused tests preserve eligible migration.
- View changes render immediately even when browser animation frames are background-throttled.
- No browser console errors or framework error overlay were present.

## Responsive matrix

| Viewport | Root width | Horizontal overflow | Sidebar state | Data & Privacy headings/actions |
|---|---:|---|---|---|
| 360×800 | 360 | none | collapsed, fully labeled | visible |
| 390×844 | 390 | none | collapsed, fully labeled | visible |
| 768×1024 | 768 | none | collapsed, fully labeled | visible |
| 1440×900 | 1440 | none | expanded and collapsed both verified | visible |

## Automated verification

- `npm run verify:ci`: pass — 62 test files / 294 tests plus ontology, observed-work, workflow, routing, privacy, public-release, lint, source/companion build, and source lifecycle verification.
- `npm run build:desktop`: pass.
- `npm run check:desktop-boundary`: pass — 29 assertions.

