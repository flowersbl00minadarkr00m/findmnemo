# Model Routing Preferences

FindMnemo's Model Routing module stores a local preference policy for the models, local runtimes, and agent surfaces a person uses. It recommends an eligible route for a ticket and waits for explicit confirmation. It does not send, retry, or reroute requests.

## Policy boundary

The policy profile is `findmnemo.model-routing.v1` with schema and catalog version `1.0.0`. It contains:

- Stable route IDs and editable display identity: provider, model, surface, and route kind.
- Binary capability assignments: supported or unsupported.
- User-confirmed `available` or `unavailable` state with a confirmation timestamp.
- One default ordered route list.
- Optional capability-specific ordered lists.
- A snapshot of every referenced built-in, custom, or imported capability definition.

Route IDs are generated independently of display labels. Renaming a provider, model, surface, route, or capability label does not need to change relationship IDs.

The policy deliberately contains no provider connection, endpoint, credential, API key, cookie, session, quota, billing, cost, token-usage, or automatic health state.

## Capabilities

The built-in catalog groups personal work into:

- Orchestration: requirements design, technical design, task design, and workflow orchestration.
- Review: specification alignment, code quality, and quality assurance.
- Creation: writing, image generation, and video generation.
- Engineering: coding and debugging.
- Research and analysis: web research and data analysis.

Custom capability IDs use `custom:<normalized-slug>`. Normalization lowercases the label and converts punctuation/spacing runs to one hyphen. Equivalent labels produce the same proposed ID. FindMnemo never silently merges a collision: reuse the existing capability or enter a distinctly named capability.

Cost, speed, context length, privacy tier, and availability are not work capabilities in this version.

## Manual availability and ordering

Availability is manual. FindMnemo does not claim to know whether OpenAI, Anthropic, Gemini, Hermes, a local runtime, or another surface has reached a rate, token, or account limit.

For confirmed required capabilities, FindMnemo builds one deterministic effective order:

1. Select matching capability-specific lists in policy order.
2. Concatenate them and retain the first occurrence of each route ID.
3. Append the default list, again retaining only first occurrences.

An exact route must be enabled, manually available, present in the effective order, and support every required capability. The first exact route is the recommendation.

If no exact route exists, FindMnemo stops normal recommendation. It shows partial routes, their supported and missing capabilities, and exclusion reasons. Choosing a partial route requires the explicitly labeled capability-gap override action.

## Ticket inference and confirmation

The ticket flow uses a versioned local rule table over existing ticket and SDD metadata. It makes no model or network call. Suggested capabilities and matched rule IDs are visible before evaluation, and the user can add or remove capabilities.

Evaluation marks the selected set as user-confirmed for that result. A policy or capability change makes the result stale; stale results cannot be confirmed or overridden.

Exact confirmation and partial override create routing decision records. Neither action opens a provider, copies a prompt, calls a gateway, or executes work.

## Local storage, import, and export

The active policy uses local-storage key `findmnemo_model_routing_policy_v1`.

Import is two-phase:

1. Parse, recursively scan for credential-shaped content, validate the closed schema, and show a material preview.
2. Apply only after explicit confirmation.

Malformed, unsupported, unknown-field, dangling-reference, or credential-bearing input cannot replace the active policy. Invalid stored data is reported and left unchanged rather than automatically rewritten.

Exports use `findmnemo-model-routing-policy-YYYY-MM-DD.json`. Treat the file as private preference metadata even though credentials and raw work content are prohibited.

## Decision evidence and privacy

FindMnemo records evidence only after exact confirmation or explicit partial override. Recommendation-only, stale, cancelled, invalid, and abandoned flows record nothing.

Evidence uses the existing `WorkTelemetryEvent` schema:

- Activity `model-route-confirmed` or `model-route-overridden`, type `decide`.
- Human actor and ticket case identity.
- Route source reference `mnemosync://model-route/{routeId}`.
- Decision type, policy revision, required capability IDs, and missing capability IDs.
- Truth state `user-confirmed` or `overridden`.

Evidence excludes ticket titles and descriptions, prompts, notes, emails, provider endpoints, credentials, and secret values. A local evidence-write failure is shown separately and does not undo or change the selected routing decision.

## Future provider adapters

A route target is preference identity, not a provider connection. A future approved companion, gateway, or provider adapter may associate a route ID with a separately governed connection and execution contract. That future layer must keep credentials out of this policy, preserve route IDs, and retain the explicit-confirmation boundary unless a later approved specification changes it.

## Verification

Run:

```text
npm run check:routing
npm run check:ontology
npm run check:observed-work
npm run check:workflow
npm run lint
npm run build
```

The routing check covers closed validation, credential privacy, inference, exact/no-match behavior, staged portability, confirmation/override decisions, and minimized telemetry evidence. UI verification additionally covers keyboard controls, focus, import preview, and responsive layouts.
