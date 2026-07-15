# Source setup and project folders

The first operational connection opens a source chooser. Every source is optional and explains what it reads, what remains private, and what it can add before refresh.

- **Gmail follow-up** uses locally approved Gmail metadata and creates Outreach candidates. It does not create or link a ticket without an explicit action.
- **Project folders** accepts one or several folders chosen in the installed FindMnemo window. SDD is optional. Git/project markers provide basic identity; unsupported generic folders remain connected with limited evidence and do not invent tasks.
- **Agent activity** uses only a separately registered local ledger contract.
- **Model usage** reads locally observed usage and coverage for Metrics.
- Choosing none is valid. FindMnemo refreshes its own ticket source and opens My Day.

Folder paths, pairing codes, preview tokens, credentials, prompts, responses, and raw logs never enter browser-safe source records. Hosted browsers can rename, pause, resume, or remove an existing folder by opaque ID, but cannot create or edit a path. Removing a folder from FindMnemo never deletes the directory.

After setup, **Data & Privacy** is the single place to review sources and independently pause, resume, or remove project folders. Daily source health shows configured sources only; an integration that was never chosen is not displayed as broken.

The source-run helper `npm run folders:add` uses the same bounded preview/confirmation service. The Windows desktop package provides the native multi-folder picker. Parent-folder discovery, whole-drive scanning, and deriving work from unsupported generic files are intentionally not included.
