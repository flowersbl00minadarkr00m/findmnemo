# FindMnemo Product Design Direction

Status: Approved direction for final UI design  
Decision date: 2026-07-12  
Decision owner: Henry

## Decision

FindMnemo will use two coordinated views over the same operational data and actions:

1. **Operations Desk** is the primary and default workspace.
2. **Daily Brief** is an optional simplified view for quickly resolving the day's highest-priority decisions.

These are not separate products or disconnected dashboards. They must share source truth, evidence, dispositions, navigation, terminology, and action behavior. Switching views changes information density and prioritization, not the underlying state.

## Primary View: Operations Desk

The default experience is optimized for repeated operational work across Pi, Codex, Claude, Gmail, tickets, projects, and SDD.

The desktop layout should provide:

- A compact left navigation rail.
- A dense, sortable attention queue as the main work surface.
- A persistent evidence inspector for the selected item.
- A source-health strip showing current, stale, partial, and disconnected states truthfully.
- Direct access to provenance, acceptance criteria, agent receipts, blockers, rollback notes, and human disposition controls.
- A visible view control for switching to Daily Brief.

The queue should prioritize scanning and comparison. Evidence must remain visible before consequential acceptance actions.

## Simplified View: Daily Brief

Daily Brief is optimized for fast first value and lower cognitive load. It should answer: "What needs my decision today?"

The desktop layout should provide:

- A prioritized vertical stream of items that need action.
- Clear separation between `Needs action`, `Waiting`, and `Recently resolved`.
- One obvious primary action per item, with secondary actions in an overflow menu.
- A compact day-status panel with agent health, source health, MnemoSync freshness, progress, and recent activity.
- Explicit stale or disconnected warnings with a safe recovery action.
- A visible view control for returning to Operations Desk.

Daily Brief should use progressive disclosure. Detailed evidence remains available on demand and must resolve to the same records and actions used by Operations Desk.

## Shared Interaction Contract

- Operations Desk is the initial view unless the user has explicitly saved another preference.
- Switching views must preserve the selected project, filters where meaningful, and unresolved work state.
- Accepting, linking, retrying, dismissing, or resolving work in either view updates the same durable record.
- Fictional sample data must remain visibly distinct from live operational data.
- Stale, partial, disconnected, and unverified states must never resemble current verified data.
- Gmail and private operational data remain local to the companion unless a separate approved contract explicitly permits otherwise.
- Agent identity colors remain distinct where they improve source recognition.

## Clownfish Visual System

Both views will use the existing Clownfish visual direction defined in [`CLOWNFISH_RESKIN.md`](../CLOWNFISH_RESKIN.md).

Core palette:

- Primary orange: `#FF7A2F`
- Deep orange: `#E8641C`
- Highlight orange: `#FF9A5C`
- Near-white: `#F4F7F8`
- Page: `#0D1417`
- Navigation: `#0B1013`
- Panel: `#141D23`
- Border: `#26343D`
- Verified: `#4ADE80`
- Warning: `#F4B63F`
- Blocked or alert: `#FF5F6D`

The minimal side-profile clownfish mark is the primary product icon: orange body, two white bands, and a dark eye. Orange is reserved for current focus, primary commands, selection, and structural highlights. It should not overwhelm status semantics or agent identity.

## Visual Standards

- Use compact, readable typography and stable desktop dimensions.
- Prefer flat operational regions and tables over decorative card grids.
- Keep corners restrained at approximately 3-6 px.
- Use familiar icons and tooltips for unfamiliar icon-only controls.
- Avoid nested cards, giant headings, marketing composition, decorative particles, bubbles, or excessive glow.
- Maintain restrained visual density in Daily Brief and higher information density in Operations Desk.
- Ensure both views remain coherent at supported desktop widths without text or control overlap.

## Implementation Sequence

1. Establish the shared view model, actions, source-state semantics, and persisted view preference.
2. Implement Operations Desk as the default route or default mode.
3. Implement Daily Brief as a simplified projection over the same data and commands.
4. Apply the Clownfish logo, palette, and shared component tokens to both views.
5. Verify cross-view state consistency, stale/disconnected truthfulness, keyboard operation, and desktop responsive behavior.
6. Capture final implementation screenshots only after the screens are backed by real application components and verified data-state behavior.

## SDD Boundary

This document records product-design direction. It does not modify approved feature requirements or technical designs. Any implementation that changes an approved behavioral contract must return to the applicable SDD stage before work proceeds.
