# Personal ontology and FindMnemo observed work

## Contract boundary

The **personal ontology** is the shared, versioned contract in `packages/personal-ontology`. It defines the common bundle envelope, object, link, action, evidence, truth-state, compatibility, and handoff primitives used across products.

**FindMnemo observed work** is a product profile built on that contract. FindMnemo maps tickets, notes, decisions, artifacts, agent activity, email-derived work, AI receipts, telemetry, and project progress into the shared primitives. It does not create a competing ontology or expose FindMnemo's internal storage schema as the interchange contract.

The FindMnemo export is identified by:

- user-facing label: `FindMnemo observed work` / `Export observed work`;
- filename: `findmnemo-observed-work-YYYYMMDD.json`;
- `bundleProfile`: `findmnemo.observed-work.v1`;
- `bundleKind`: `observed-work`.

The existing telemetry export is a separate, narrower activity-ledger interface and remains available.

## Shared primitives

Every personal-ontology bundle uses the shared schema version and can contain:

- objects with stable IDs, type, profile, truth state, timestamps, source references, and bounded properties;
- typed links between objects;
- action definitions describing supported transitions and their confirmation rules;
- evidence references and provenance sufficient to trace a mapped object to its source;
- compatibility metadata describing the profile, accepted/emitted source types, legacy identifiers, and intended consumers;
- validated handoff envelopes for proposing an action to another product.

FindMnemo produces the observed-work layer. FlowSensa consumes compatible observed work for process analysis; OSSensa, SancusSight, and LocalCFO may consume the common objects and links according to their own profiles. Consumers must branch on `bundleProfile` and `bundleKind`, validate the shared schema, tolerate additive compatible fields, and must not assume a FindMnemo export is a process-analysis or governance-registry bundle.

## Compatibility identifiers

The public product name is **FindMnemo**, but this release does not migrate wire or storage identifiers. The following legacy identifiers remain readable and, where the current adapter requires them, emitted:

- provenance `sourceType: "mnemosync"`;
- source references using the `mnemosync://` URI scheme;
- local browser keys `mnemosync_tickets`, `mnemosync_agent_activity`, `mnemosync_emails`, `mnemosync_work_events_v1`, and `mnemosync_project_progress_items`;
- historical product names `MnemoSync`, `Mnemosync`, and `mnemosync`.

Do not rewrite, delete, or stop accepting these identifiers as part of a display-name change. A wire/storage migration requires a separate approved specification, dual-read or migration behavior, downstream compatibility tests, and a rollback plan.

## Handoffs into FindMnemo

Handoffs use `handoffProfile: "personal-ontology.handoff.v1"`, the shared schema version, a named source product, `targetProduct: "FindMnemo"`, an action type, summary, object/evidence references, bounded payload, and `confirmationRequired: true`.

FindMnemo currently accepts propose-only handoffs for:

- `track-implementation`;
- `attach-artifact`;
- `record-decision`;
- `close-loop`.

Validation is atomic: unsupported profiles/actions, missing required fields, or extra disallowed payload fields reject the complete handoff. A failed validation must not mutate tickets, artifacts, decisions, status, or telemetry. A valid handoff is still a proposal and requires user confirmation before mutation.

## Product and deployment rename boundary

`https://findmnemo.vercel.app` is the preferred public URL. `https://mnemosync.vercel.app` remains the legacy fallback until its removal is separately approved and verified.

GitHub repository renames, Vercel project/domain changes, redirects, link updates, and alias removal are external operations. They are not automatic consequences of the FindMnemo UI rename and require explicit approval plus verification of deployment health, redirects/aliases, environment bindings, documentation links, integrations, and rollback. The Vercel project and preferred public URL migrated to FindMnemo on 2026-07-14; machine identifiers and the legacy alias remain unchanged.

## Verification commands

Run the profile and shared-contract checks before changing this boundary:

```text
npm run check:ontology
npm run check:observed-work
npm run check:workflow
```

These checks supplement, rather than replace, downstream consumer and deployment verification for any future migration.
