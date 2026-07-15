# FindMnemo navigation

FindMnemo's five primary areas spell **MNEMO** and use plain-language labels:

1. **My Day** — today's operational view. Switch between **Operations Desk** and **Daily Brief**; FindMnemo remembers the last choice.
2. **Next Actions** — tickets and generated project/SDD work. Project scanning and SDD provenance still run through the companion, but there is no separate Projects/SDD page.
3. **Engines** — AI connections, readiness checks, model choices, and routing preferences.
4. **Metrics** — switch between **Model Usage** and **Work Metrics**. Model Usage reports local model evidence; Work Metrics uses ticket history. They are not combined or treated as interchangeable.
5. **Outreach** — Gmail response candidates and their ticket links.

**Data & Privacy** is a utility outside the acronym. It contains companion-backed download/restore controls and the bounded legacy compatibility tools that previously occupied the global header.

Old names remain searchable for one compatibility path: Dashboard opens My Day, Projects/SDD opens Next Actions, Model Routing opens Engines, Model Usage or Analytics opens the matching Metrics view, and Emails opens Outreach. The Sample workspace uses the same navigation but remains fictional, session-only, and unable to call operational data APIs.

On narrow screens the sidebar starts collapsed. Each one-letter marker retains its full accessible label and tooltip; expanding it reveals the plain-language name and available count.

## Completed work

**Next Actions** has one **Active / Completed** switch. Completed work defaults to 30 days and supports 7 days, 90 days, 12 months, or a custom date range. Only explicit completion timestamps enter a range; older Done records without a reliable completion date are disclosed separately instead of receiving a guessed date. The Completed metric opens this same history and range.
