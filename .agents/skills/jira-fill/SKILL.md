---
name: jira-fill
description: Fill the fields of a JIRA workitem (ticket)
---

Load and follow the `jira-api` skill (`/Users/szymonograbek/.agents/skills/jira-api/SKILL.md`) to make all Jira API calls. Your job is to fill in whatever user requested. JIRA is mostly for non-technical people, so skip implementation details and focus on:
- What needs to be changed
- Acceptance criteria
- Testing steps

You can use these exact headers if the description doesn't have any defined structure.
If the workitem already has some structure, don't modify it, adapt to it.
Update the content if it's stale.
Use ADF JSON when filling in the text, other ways like markdown don't work.

