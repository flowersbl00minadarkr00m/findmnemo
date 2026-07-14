# Downloading and moving FindMnemo data

Open **Data & Privacy** from the sidebar or header in the Operational workspace. These actions run through the paired local companion; the Sample workspace cannot read, download, restore, or change operational data.

## Download my data

FindMnemo first shows the local categories, record counts, coverage, freshness, and exclusions it can verify. Tickets/work, decisions/receipts, routing policy, and normalized model usage are selected by default. Minimized email metadata is off until explicitly selected.

The download is one readable `*.findmnemo.json` file with a manifest and separately versioned category artifacts. It is not a promise of complete account history. Credentials, authorization material, raw Gmail bodies, prompts, responses, transcripts, raw agent logs, raw Tokscale output, Sample records, and browser-only legacy activity are excluded. Store the file somewhere private because selected work metadata may still be sensitive.

## Restore or move data

Choose a FindMnemo bundle to create a ten-minute, memory-only preview. Nothing changes during preview. The MVP can add new tickets/work and add a routing policy only when no current policy exists. Existing ticket IDs and routing policies are preserved; model usage, execution receipts, and email evidence are export-only so imported files cannot masquerade as locally observed truth.

Confirming applies only safe additions and returns a qualified receipt. Repeating the same import cannot duplicate a ticket. Unsupported versions, malformed or oversized files, credential-shaped values, prohibited fields, expired plans, and unsafe conflicts fail closed without replacing current records.

## Advanced compatibility

Advanced contains the current/legacy FindMnemo identity note, observed-work compatibility export, and one-release browser-only legacy activity tools. Browser-local activity is explicitly incomplete and is never included in the default operational bundle. The original browser storage is not silently deleted or rewritten.

Standalone Usage JSON/CSV remains available under **Manage local data**. Gmail disconnect/re-authorization and Usage history/mapping deletion keep their owning feature's existing confirmations and privacy rules.
