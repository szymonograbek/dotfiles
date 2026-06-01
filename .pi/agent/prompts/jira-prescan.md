---
description: Read a Jira ticket from branch or argument and understand it
argument-hint: "[JIRA-KEY]"
---

Derive the Jira ticket key from `$ARGUMENTS` if provided; otherwise derive it from the current branch name. If no ticket key is present, ask the user for it.

Load and follow the `jira-api` skill to read the work item details.
