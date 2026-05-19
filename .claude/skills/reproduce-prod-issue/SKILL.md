---
name: reproduce-prod-issue
description: >
  Reproduce a production issue in the test channel, diagnose the root cause, fix it in
  code, verify the fix, and run targeted e2e tests covering the affected feature area.
  Use whenever the user reports unexpected bot behaviour in production. Requires issue
  context as an argument (plain description, optionally with screenshots or files). If
  no context is provided, or if the description is too vague to identify the problem,
  ask targeted follow-up questions before proceeding.
---

## What this skill does

1. Parses issue context from the argument; asks follow-up questions only when needed
2. Ensures the local test environment is ready (Docker + dev server)
3. Reproduces the issue in **#庫存小幫手\_test** (C0B3WP0V64B) — never in production
4. Diagnoses root cause from server logs and source code
5. Fixes the issue and commits on `dev`
6. Verifies the fix in the test channel
7. Runs the e2e test groups that cover the affected feature

---

## Core rules

- **Never interact with the production channel** (#庫存小幫手). All bot interaction must
  go through the test channel (#庫存小幫手\_test, channel ID `C0B3WP0V64B`).
- Use **Slack MCP** (`slack_send_message`, `slack_read_channel`) for all message-level
  testing.
- Use **computer-use MCP** for clicking Block Kit buttons (確認 / 取消) — the Slack MCP
  cannot click buttons. Load all computer-use tools in one ToolSearch call
  (`query: "computer-use", max_results: 30`) before using them.
- Fixes go on the `dev` branch. Never commit directly to `staging` or `main` as part of
  this skill.
- Wait at least **8 seconds** after sending a message before reading the channel (NLU
  takes 3–5 s; more for large batches).

---

## Step 1 — Collect issue context

If the skill was invoked **without arguments**, ask:

> "Please describe the production issue. Include: what you observed, what input triggered
> it, and what you expected to happen instead. Screenshots or logs are welcome."

If arguments were provided but are **too vague to identify the affected feature or flow**
(e.g. "something is broken", "the bot doesn't work"), ask targeted follow-ups:

- Which bot feature or flow was involved? (e.g. onboarding, restock, record consumption,
  revert, purge expired, session conflict, Block Kit buttons)
- What exact message or action triggered the issue?
- What did the bot reply? (copy-paste or screenshot)
- What did you expect to happen instead?

Do **not** ask questions that can be answered from the description. Proceed as soon as
you have enough information to reproduce the issue.

---

## Step 2 — Prepare the test environment

Check that the dev server and Docker containers are running:

```bash
curl -sf http://localhost:3000/health && echo "server up" || echo "server down"
docker ps --filter "name=life-helper" --format "{{.Names}}" 2>/dev/null
```

**If the server is down**, start it:

```bash
pkill -f "tsx.*main.ts" 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null; sleep 1
cd /Users/xfreddy2007/Documents/Self-projects/life-helper && npx tsx apps/bot/src/main.ts > /tmp/life-helper-dev.log 2>&1 &
until curl -sf http://localhost:3000/health > /dev/null 2>&1; do sleep 2; done
echo "Server up"
```

**If Docker containers are missing**, start them and run migrations:

```bash
docker compose -f /Users/xfreddy2007/Documents/Self-projects/life-helper/docker-compose.yml up -d 2>&1
# wait for healthy
for i in $(seq 1 30); do
  unhealthy=$(docker compose -f /Users/xfreddy2007/Documents/Self-projects/life-helper/docker-compose.yml ps 2>/dev/null \
    | grep -E "postgres|redis" | grep -v "healthy" | wc -l)
  [ "$unhealthy" -eq 0 ] && echo "✅ Containers healthy" && break
  sleep 2
done
# migrate + seed
cd /Users/xfreddy2007/Documents/Self-projects/life-helper/packages/database && \
  DATABASE_URL="postgresql://lifehelper:lifehelper_dev@localhost:5432/life_helper" \
  npx prisma migrate deploy 2>&1
DATABASE_URL="postgresql://lifehelper:lifehelper_dev@localhost:5432/life_helper" \
  npx tsx prisma/seed/seed.ts 2>&1
```

> You do **not** need to reset the DB unless a clean state is required to reproduce the
> issue. Only reset if the issue involves specific inventory state.

---

## Step 3 — Reproduce the issue in the test channel

Send the same input that triggered the production issue to **C0B3WP0V64B** via
`slack_send_message`. Replicate the full interaction sequence (multi-step flows,
button clicks, etc.).

**For Block Kit button clicks**, use the computer-use procedure:

1. Load tools: `ToolSearch { query: "computer-use", max_results: 30 }`
2. `request_access` with `apps: ["Slack"]`
3. `open_application` with `"Slack"`
4. `screenshot` to see the current state
5. Zoom in on the button region to confirm coordinates: `zoom { region: [x0, y0, x1, y1] }`
6. `left_click` at the button coordinates
7. Wait 5 s, then verify via `slack_read_channel`

After each step, confirm whether the issue is reproduced and record the bot's actual reply.

---

## Step 4 — Diagnose the root cause

Check the dev server logs for errors, warnings, or unexpected NLU output:

```bash
grep -i "error\|warn\|NLU\|failed\|parse" /tmp/life-helper-dev.log | tail -30
```

Identify the relevant handler by tracing the intent → handler path:

- `START_ONBOARDING` → `onboarding.handler.ts`
- `RESTOCK` → `restock.handler.ts`
- `RECORD_CONSUMPTION` → `record-consumption.handler.ts`
- `REVERT_OPERATION` → `revert.handler.ts`
- `PURGE_EXPIRED` → `purge-expired.handler.ts`
- Session flows → `intent-router.ts`, `session.ts`
- NLU failures → `services/nlu/nlu.service.ts`

Read the affected files, form a clear hypothesis about the root cause, and confirm it
before making any code changes.

---

## Step 5 — Fix the issue

Apply the minimal change that resolves the root cause. Follow the project's coding
standards:

- No unnecessary refactoring of surrounding code
- No new abstractions beyond what the fix requires
- TypeScript must pass: `npm run check-types` (in `apps/bot/`)
- Commit on `dev` with a descriptive message following conventional commits:

```bash
git add <affected files>
git commit -m "fix(<scope>): <what was broken and what fixes it>"
```

---

## Step 6 — Verify the fix in the test channel

Repeat the exact reproduction steps from Step 3. Confirm:

- The issue no longer occurs
- The bot's response matches the expected behaviour
- No regressions in adjacent functionality (e.g. if fixing onboarding, also confirm
  the basic inventory query still works)

---

## Step 7 — Run targeted e2e tests

Do **not** run the full e2e suite. Identify which test groups from the e2e-test skill
cover the fixed feature, then execute only those groups following the same step-by-step
procedure as the e2e-test skill (Slack MCP messages + 8 s waits + channel reads).

**Feature → test group mapping:**

| Affected feature                            | Run groups |
| ------------------------------------------- | ---------- |
| NLU parsing / intent classification         | A1, A3     |
| QUERY_INVENTORY                             | A2, C1, C2 |
| RESTOCK flow                                | B1, B2, B3 |
| RECORD_CONSUMPTION / anomaly detection      | D1, D2, D3 |
| RECORD_CONSUMPTION batch grouping / revert  | D4, F2     |
| Session conflict guard (SESSION_INTERRUPT)  | E1, E2     |
| REVERT_OPERATION (single)                   | F1         |
| REVERT_OPERATION (batch)                    | F2         |
| PURGE_EXPIRED                               | G1         |
| SET_CONFIG                                  | H1         |
| START_ONBOARDING / RESET_CONFIRM            | A2, E1     |
| Block Kit buttons (any confirm/cancel flow) | E1, F1, D2 |
| App mention path                            | I1         |

For each selected test case, follow the procedure from the e2e-test skill:
send input → wait 8 s → `slack_read_channel` → record PASS or FAIL.

If a test requires a Docker reset for a clean DB, do it. Otherwise reuse the current
test channel state.

Report results:

```
Targeted e2e — <feature area>
  [ID] Description ... ✅ PASS / ❌ FAIL
  ...
All targeted tests passed. Fix is verified.
```

---

## Step 8 — Add test cases to the e2e-test skill

After every fix, add one or more test cases to
`.claude/skills/e2e-test/SKILL.md` so the issue can never silently regress.

**What to add:**

- A new test case in the group that matches the affected feature (D for
  RECORD_CONSUMPTION, F for REVERT_OPERATION, etc.)
- Use the next available ID in that group (e.g. D4 if D3 already exists)
- Cover the exact input that triggered the issue **and** the expected
  good-path response after the fix
- If the fix introduced a new multi-step flow or changed existing
  confirmation behaviour, add a cancel-path test too

**Where to place it:** immediately after the last test case in the
matching group, before the next group header.

Commit the skill update on `dev` together with the code fix, or as a
follow-up commit in the same session.

---

## Step 9 — Push the fix

```bash
git push origin dev
```

Summarise the full investigation:

- **Issue**: what the user reported
- **Root cause**: the exact code path and reason
- **Fix**: what was changed and why
- **Verified**: which test groups passed
