# Spec 011 companion data-portability acceptance

Date: 2026-07-14  
Platform: Windows  
Authority: paired local FindMnemo companion

This evidence is sanitized. It does not retain exported operational artifacts, record content, local paths, email metadata, credentials, prompts, responses, transcripts, raw logs, or raw Tokscale output.

## Contract and service acceptance

- Export preview is companion-owned and reports category state, safe counts, freshness, coverage, defaults, and exclusions.
- Default categories are tickets/work, decisions/receipts, routing policy, and model usage. Email metadata remains off until selected.
- The deterministic `findmnemo.data-bundle.v1` container preserves versioned owning profiles.
- Sample and browser-only legacy records are excluded from operational bundles.
- Import is bounded to 10 MB, preview-first, memory-only, and expires after ten minutes or companion restart.
- The user explicitly selects safe importable categories before commit.
- Existing ticket IDs and routing policy are preserved; usage, receipts, and email evidence remain export-only.
- Same-key retry returns the same content-free receipt and cannot duplicate a ticket.
- Unknown artifact versions, malformed fields, prohibited keys, and credential-shaped values fail closed before mutation.
- The browser receives only preview summaries, normalized category state, and content-free receipts; credentials and raw source material stay outside browser code.

## Live browser acceptance

- The current companion served the new export-preview route after a controlled restart.
- Data & Privacy rendered real operational category state with the approved safe defaults and email opt-in warning.
- Manage local data exposes Usage JSON/CSV plus links to the owning routing, Usage clear/mapping, and Gmail disconnect/re-authorization controls.
- The Sample workspace remains read-only and makes no operational portability call.
- The final browser pass showed no alert, console error, or error overlay.

## Automated verification

- Focused portability/navigation suite: pass — service contract, safe defaults, Sample isolation, explicit import selection, idempotency, unsupported versions, credential shapes, and legacy notice behavior.
- `npm run verify:ci`: pass — 62 test files / 294 tests and all project privacy/release gates.
- `npm run build:desktop`: pass.
- `npm run check:desktop-boundary`: pass — 29 assertions.

