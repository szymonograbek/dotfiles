---
name: jira-fill
description: Fill the fields of a JIRA workitem (ticket)
---

Use atlassian cli skill. Your job is to fill in whatever user requested. JIRA is mostly for non-technical people, so skip implementation details and focus on:
- What needs to be changed
- Acceptance criteria
- Testing steps

You can use these exact headers if the description doesn't have any defined structure.
If the workitem already has some structure, don't modify it, adapt to it.
Use ADF JSON when filling in the text, other ways like markdown don't work.

To edit description please use `acli jira workitem edit`
