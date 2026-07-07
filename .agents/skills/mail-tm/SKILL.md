---
name: mail-tm
description: "Create disposable mail.tm email accounts and read their inboxes via a local helper script. Use when the user needs a temporary email address, OTP/signup verification email, inbox polling, or mail.tm message lookup."
---

# mail.tm

Use the helper script for disposable email accounts and inbox reads.

## Prerequisites

- `node` >= 18 on PATH.
- No API key is required.
- Optional env:
  - `MAIL_TM_BASE_URL` defaults to `https://api.mail.tm`
  - `MAIL_TM_PASSWORD` default password for generated accounts

## Script

The helper script lives **in the same directory as this SKILL.md file** (`scripts/mail-tm.mjs`).
Resolve it against the skill directory — do **not** search the repo. Use it directly:

```sh
node <skill-dir>/scripts/mail-tm.mjs <command> ...
```

The script emits JSON and exits non-zero on hard errors.

Common commands:

```sh
node <skill-dir>/scripts/mail-tm.mjs domains
node <skill-dir>/scripts/mail-tm.mjs create [localPart] [password]
node <skill-dir>/scripts/mail-tm.mjs token <address> <password>
node <skill-dir>/scripts/mail-tm.mjs inbox <address> <password> [limit]
node <skill-dir>/scripts/mail-tm.mjs poll <address> <password> [timeoutSeconds] [intervalSeconds]
node <skill-dir>/scripts/mail-tm.mjs message <address> <password> <messageId>
node <skill-dir>/scripts/mail-tm.mjs delete-message <address> <password> <messageId>
node <skill-dir>/scripts/mail-tm.mjs request GET /domains
```

## Workflow

1. Create an address with `create` unless the user already gave one.
2. Save the returned `address` and `password` in the conversation; mail.tm requires both to read mail.
3. Use the address in the target app or website.
4. Poll for incoming mail with `poll <address> <password>`.
5. Read the full email with `message <address> <password> <messageId>`.
6. Extract OTPs or links from `text`, `html`, or `intro`.

## Notes

- Temporary mail can be unreliable or blocked by some services.
- Do not expose or persist passwords beyond the task.
- `poll` returns as soon as any message arrives; use `inbox` to list existing messages.
- `request METHOD PATH [json]` supports unsupported mail.tm endpoints.
