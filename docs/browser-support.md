# FindMnemo browser support and recovery

Verified on Windows on 2026-07-11:

| Browser | Installed version | Hosted-to-loopback status | Local fallback |
|---|---:|---|---|
| Microsoft Edge | 150.0.4078.48 | Hosted access, fresh pairing, reload recovery, and verified companion passed | Operational local fallback verified at `http://127.0.0.1:3210/app` |
| Google Chrome | 150.0.7871.102 | Hosted access, fresh pairing, reload recovery, and verified companion passed | Operational local fallback verified at `http://127.0.0.1:3210/app` |
| Other browsers | Unverified | Do not infer support from a generic fetch result | Use the local fallback |

## Recovery decision tree

1. Run `npm run companion:doctor`.
2. `COMPANION_STOPPED`: start the companion and retry identity.
3. `PORT_IN_USE`: stop or reconfigure the conflicting process; never send private requests until FindMnemo identity verifies.
4. `IDENTITY_MISMATCH`: close the unexpected listener and restart the companion.
5. `ORIGIN_NOT_ALLOWED`: use the exact production origin or local fallback.
6. `permission-denied`: reset the site's local-network permission in Edge/Chrome settings, or continue through the local fallback.
7. `pairing-required` or expired session: generate a new one-time code locally and pair again.
8. `stale`: retry authenticated status before trusting counts.
9. Generic fetch failure: keep the state as `error`; check doctor, local fallback, VPN/firewall, and enterprise policy in that order. Do not claim a specific cause without diagnostic evidence.

The local fallback uses the same companion API and SQLite database. It is not a second data store.

Live browser acceptance used the installed Edge and Chrome profiles. Both reached the hosted pairing flow, rejected a reused code, accepted a fresh single-use code, and showed `Companion verified`; the local fallback also loaded the same operational store without a Sample banner.

## Release browser checklist

Run these steps in both Edge and Chrome against the production `/app` URL:

1. Reset the site's local-network permission, choose **Connect local companion**, and review the first permission prompt.
2. Allow access, enter a fresh one-time pairing code, and confirm the workspace reaches `connected`.
3. Reset and deny access; confirm FindMnemo reports `permission-denied` or an evidence-neutral `error` and offers diagnostics/local fallback.
4. Allow access again, reconnect, reload the hosted tab, and confirm a fresh pairing is required.
5. Stop the companion and confirm the UI does not guess firewall, VPN, or enterprise-policy causes; restart and recover.
6. Open the local fallback and confirm it shows the same operational tickets without the fictional Sample banner.

Automated evidence covers stopped, occupied port, identity mismatch, stale/unsupported/error copy, exact-origin rejection, session expiry/rotation, and local fallback loading. Firewall, VPN, and enterprise-policy states remain ambiguous unless doctor provides a specific code.
