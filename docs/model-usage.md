# Local model-usage observability

The **Metrics > Model Usage** view answers which models you use, through which local coding tools, how tokens and estimated costs change, where evidence is incomplete, and how observed usage relates to your saved routing profiles.

## Turnkey setup

1. Run the FindMnemo Windows companion and open its local app.
2. Open **Metrics**, then choose **Model Usage**. Tokscale 4.5.2 is built into the Windows package; you do not install Tokscale separately and FindMnemo never signs in to Tokscale.
3. Choose **Refresh usage**. The first release refreshes only when you ask; there is no scheduler.
4. Review source coverage. Unavailable clients and diagnostics mean the result is partial, not that account usage is zero.
5. Map any **Unmapped models** to a saved Model Routing profile when the exact identity is clear. Manual mappings do not change the profile order, readiness, availability, or behavior.

FindMnemo retains normalized daily evidence for 12 months. A refresh atomically replaces overlapping normalized days, preventing a rescan from double-counting them. Session/workspace records are attribution aids only and remain non-additive.

Source-run users receive the qualified platform collector through the locked `npm ci` dependency install. FindMnemo selects that dependency directly, not an ambient global command. The Usage capability card reports **Built-in collector ready**, its exact version, and whether a support-only external recovery path was selected.

If the built-in collector is missing or damaged, repair or reinstall the same FindMnemo release. Developers/support may set `FINDMNEMO_TOKSCALE_EXTERNAL_PATH` to an absolute compatible Tokscale executable as a local fallback; FindMnemo uses it only when its own packaged/source collector is unavailable and still applies the same version, command, timeout, output, cleanup, and privacy checks.

## Reading the numbers

- **Known zero** means the source explicitly reported zero.
- **Unknown** means the source did not supply the field. FindMnemo does not silently turn unknown into zero.
- **Estimated cost** is Tokscale-derived evidence with pricing provenance. It is not a bill, account balance, rate limit, or subscription quota.
- **Partial coverage** means some supported local sources were unavailable, failed, or returned incomplete fields.
- **Past usage** badges on Model Routing are factual links to filtered evidence. They are not route recommendations and cannot execute or reorder work.

Use the period, client, provider, model, and mapping filters to narrow the view. JSON and spreadsheet-safe UTF-8 CSV exports contain normalized records and provenance. They exclude prompts, responses, transcripts, credentials, cookies, raw logs, raw CLI output, local paths, account identifiers, and readable session/workspace names.

## Privacy boundary

Tokscale runs only on the companion machine. Raw Tokscale JSON is held in bounded process memory or an exclusive temporary graph file and is removed after normalization. The local database receives normalized daily records, opaque HMAC identities for optional attribution, coverage metadata, refresh states, mappings, and provenance.

The qualified collector is the published `@tokscale/cli` 4.5.2 package under the MIT License. FindMnemo pins that exact version and ships Tokscale attribution in `THIRD_PARTY_NOTICES.md`; it does not copy Tokscale parsers, read Tokscale private storage directly, or download/upgrade the collector at runtime.

The browser receives normalized records, aggregate summaries, source availability, safe reason codes, freshness, mappings, and factual route observations. Provider credentials, Tokscale credentials, prompts, responses, transcripts, raw agent logs, local paths, raw session/workspace labels, stdout, and stderr never cross the companion/browser boundary.

**Clear usage history** removes normalized records, attribution, and refresh history while preserving manual mappings. **Clear mappings** is a separate confirmation. This separation prevents an accidental history cleanup from destroying your routing identity choices.
