---
description: Fill requested fields of a Jira work item
argument-hint: "<JIRA-KEY or instructions>"
---

Fill the Jira work item fields requested by the user: `$ARGUMENTS`.

Load and follow the `jira-api` skill for all Jira API calls.

Jira is mostly for non-technical people, so skip implementation details and focus on:
- What needs to be changed
- Acceptance criteria
- Testing steps

Use these exact headers if the description does not already have a defined structure. If the work item already has a structure, do not replace it; adapt to it.

Update stale content. Use ADF JSON when filling text fields; Markdown does not work reliably for Jira rich text.
