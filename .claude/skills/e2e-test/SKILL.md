---
name: e2e-test
description: >
  Full end-to-end test suite for the life-helper bot. Resets Docker containers (Postgres +
  Redis), applies DB migrations, starts the dev server, then exercises every bot intent and
  multi-step flow through the Slack MCP. Reports a pass/fail table at the end. Use whenever
  the user says "run e2e", "run end-to-end tests", "test the bot", "e2e test", or when new
  features are added and test coverage needs to be verified.
---

## What this skill does

1. Kills any existing Postgres/Redis containers and starts fresh ones via `docker compose up`
2. Runs Prisma migrations against the clean DB
3. Kills any existing dev server on port 3000 and starts a fresh one via `npm run dev`
4. Authenticates with the Slack MCP (prompts user if needed)
5. Sends test messages to `#庫存小幫手_test` (channel `C0B3WP0V64B`) and verifies bot replies
6. Runs **all** test cases regardless of failures, then prints a full summary table
7. Leaves containers and server running for manual follow-up

---

## Prerequisites

- Docker is installed and running
- `apps/bot/.env.local` exists with valid `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_DEFAULT_CHANNEL`
- Slack MCP is authenticated (run `/mcp` → "claude.ai Slack" if not already connected)
- Slack app has event subscriptions: `message.groups`, `message.channels`, `message.im`, `app_mention`

---

## Step 1 — Reset Docker containers

Find and kill any existing `postgres` and `redis` containers for this project:

```bash
docker ps --filter "name=life-helper" --format "{{.Names}}" 2>/dev/null
```

Stop them and wipe the bind-mount data dir (`./db-data` is a bind mount so `-v` alone
does not clear Postgres data — the directory must be deleted for a clean DB):

```bash
docker compose -f /Users/xfreddy2007/Desktop/life-helper/docker-compose.yml down 2>&1
rm -rf /Users/xfreddy2007/Desktop/life-helper/db-data
```

Start fresh containers and wait until both are healthy:

```bash
docker compose -f /Users/xfreddy2007/Desktop/life-helper/docker-compose.yml up -d 2>&1
```

Poll until both Postgres and Redis pass their health checks (up to 60 seconds):

```bash
until docker compose -f /Users/xfreddy2007/Desktop/life-helper/docker-compose.yml ps | grep -E "postgres|redis" | grep -v "healthy" | wc -l | grep -q "^0$"; do
  sleep 2
done
```

If not healthy after 60 s, abort:

> ❌ Docker containers failed to become healthy. Check `docker compose logs`.

---

## Step 2 — Run DB migrations and seed

```bash
cd /Users/xfreddy2007/Desktop/life-helper/packages/database && \
  DATABASE_URL="postgresql://lifehelper:lifehelper_dev@localhost:5432/life_helper" \
  npx prisma migrate deploy 2>&1
```

If migrations fail, abort:

> ❌ Prisma migrations failed. Fix the schema before running E2E tests.

Then seed the default categories (required for item creation to work):

```bash
cd /Users/xfreddy2007/Desktop/life-helper/packages/database && \
  DATABASE_URL="postgresql://lifehelper:lifehelper_dev@localhost:5432/life_helper" \
  npx tsx prisma/seed/seed.ts 2>&1
```

---

## Step 3 — Start dev server

Kill any process already on port 3000:

```bash
lsof -ti :3000 | xargs kill -9 2>/dev/null; sleep 1
```

Start the dev server in the background from the repo root:

```bash
cd /Users/xfreddy2007/Desktop/life-helper && npm run dev > /tmp/life-helper-dev.log 2>&1 &
echo $! > /tmp/life-helper-dev.pid
```

Poll until the health endpoint responds (up to 30 seconds):

```bash
until curl -sf http://localhost:3000/health > /dev/null 2>&1; do sleep 2; done
```

If not up after 30 s, print the last 30 lines of the log and abort:

```bash
tail -30 /tmp/life-helper-dev.log
```

> ❌ Dev server failed to start. See log output above.

---

## Step 4 — Run test cases

Use the Slack MCP tools in sequence. For every test case:

1. Send the input message to channel `C0B3WP0V64B` via `slack_send_message`
2. Wait **8 seconds** (Claude NLU takes ~3–5 s; allow margin)
3. Read the last 2 messages via `slack_read_channel` (limit=2, response_format=concise)
4. Check whether the bot (`life-helper-bot`) posted a reply containing the expected content
5. Record PASS or FAIL with a reason

Track results in a running table: `| # | Description | Input | Expected | Status | Notes |`

**Important rules:**

- Run ALL cases even if earlier ones fail
- After a multi-step flow, wait for the bot's reply before sending the next message
- A FAIL is recorded if: no bot reply appears, reply is from the wrong user, or expected text is absent
- If a test case depends on state created by a previous case (e.g., an item existing in inventory), note the dependency

---

### Block Kit Button Click Procedure

Session confirmation prompts now render **Block Kit action buttons** (確認 / 取消) in Slack.
When a test step is marked `[BUTTON CLICK: 確認]` or `[BUTTON CLICK: 取消]`, use computer-use
to click the button instead of typing text:

1. **Load computer-use tools** — `ToolSearch` with `query: "computer-use", max_results: 30` to
   fetch all `mcp__computer-use__*` schemas.
2. **Request access** — call `request_access` with `applications: ["Slack"]`.
3. **Bring Slack to front** — call `open_application` with `name: "Slack"`.
4. **Screenshot** — call `screenshot` to capture the screen.
5. **Locate the button** — inspect the screenshot image; find the most recent bot message that
   contains the target button label (確認 or 取消).
6. **Click** — call `left_click` at the button's pixel coordinates.
7. **Confirm** — wait 5 s, then read the channel via `slack_read_channel` (limit=2) to verify
   the bot responded. A successful click removes the buttons from the original message and
   triggers the next bot reply.

> If the Slack window is not visible or the button is obscured, call `screenshot` again after
> `open_application` and scroll the channel to the bottom before clicking.

---

### Test suite

#### Group A — Single-turn intents (no session state)

**A1 — SHOW_FEATURES**

- Input: `功能選單`
- Expected: bot replies with the welcome message containing `居家生活小幫手` and at least 5 feature button labels (庫存盤點, 查詢庫存, 記錄消耗, 補充庫存, 採購清單)

**A2 — QUERY_INVENTORY (empty DB)**

- Input: `查詢庫存`
- Expected: bot replies with an empty-state message containing `尚無庫存資料`

**A3 — UNKNOWN intent**

- Input: `今天天氣怎麼樣`
- Expected: bot replies with fallback text containing `不太明白` or `您可以說`

**A4 — QUERY_PURCHASE_LIST (empty)**

- Input: `採購清單`
- Expected: bot replies (any non-error response about purchase list)

#### Group B — RESTOCK flow

**B1 — Unit mismatch detection**

- Input: `補充庫存 白米 2 包`
- Expected: bot reply contains `單位` and `不太合理` (unit mismatch warning) — item NOT saved

**B2 — Correct unit, no expiry**

- Input: `補充庫存 白米 2 kg`
- Expected: bot asks for expiry date containing `到期日`
- Follow-up input: `跳過`
- Expected follow-up reply: `補貨完成` and `白米 +2kg`

**B3 — Correct unit, with expiry date**

- Input: `補充庫存 橄欖油 500 ml`
- Expected: bot asks for expiry date
- Follow-up input: `2026/12`
- Expected follow-up reply: `補貨完成` and `橄欖油` and `2026/12`

#### Group C — QUERY_INVENTORY (items now exist)

**C1 — List all inventory**

- Input: `查詢庫存`
- Expected: bot reply contains `白米` and `1.5` or `2` (reflects B2 result; no consumption deducted yet) and `橄欖油`

**C2 — Query specific item**

- Input: `白米還有多少`
- Expected: bot reply contains `白米` and a quantity in `kg`

#### Group D — RECORD_CONSUMPTION flow

**D1 — Normal consumption**

- Input: `今天用了白米 0.5 kg`
- Expected: bot reply contains `消耗記錄完成` and `白米 -0.5kg`

**D2 — Anomaly detection (large amount)**

- Input: `用了白米 100 kg`
- Expected: bot reply contains a confirmation prompt (anomaly detected) with Block Kit 確認/取消 buttons
- Follow-up: `[BUTTON CLICK: 取消]` — use the Block Kit Button Click Procedure above
- Expected follow-up reply: `已取消` or similar cancellation confirmation

**D3 — Query after consumption**

- Input: `白米還有多少`
- Expected: bot reply contains `白米` and quantity less than the pre-consumption amount (confirms D1 deducted correctly)

#### Group E — SESSION_INTERRUPT (conflict guard)

**E1 — Interrupt mid-onboarding**

- Input: `開始盤點`
- Expected: bot starts onboarding flow with `重置` or `確認` prompt and Block Kit 確認/取消 buttons
- Interrupt input: `補充庫存 衛生紙 3 包`
- Expected interrupt reply: contains `正在進行中` with Block Kit 確認/取消 buttons (SESSION_INTERRUPT guard triggered)
- Resolution: `[BUTTON CLICK: 取消]` — use the Block Kit Button Click Procedure above
- Expected resolution reply: `已繼續` or `繼續目前操作` (returning to onboarding)
- Abort onboarding: `[BUTTON CLICK: 取消]` on the original RESET_CONFIRM message (still visible in channel); if that message's buttons were already removed, type `取消` instead
- Expected: session cleared (`已取消，庫存未變動`)

**E2 — Interrupt and switch**

- Input: `開始盤點`
- Expected: onboarding starts
- Interrupt input: `查詢庫存`
- Expected: query passes through (QUERY_INVENTORY is SESSION_PASSTHROUGH — no conflict guard)

#### Group F — REVERT_OPERATION

**F1 — Undo last consumption**

- Input: `撤銷操作`
- Expected: bot lists recent operations to revert (contains `白米` or a log entry)
- Follow-up input: `1` (select first entry) or whichever number is shown
  - ⚠️ **MCP suffix**: the Slack MCP appends `*發送工具* Claude` to messages; the number
    selection step uses `parseInt` which still extracts the leading digit correctly, so this
    step should parse fine
- Expected follow-up reply: bot shows confirmation prompt `確認要撤銷：…` with Block Kit 確認/取消 buttons
- Follow-up: `[BUTTON CLICK: 確認]` — use the Block Kit Button Click Procedure above
  - Clicking the button sends the exact string `"確認"` without any MCP suffix, bypassing the
    previous MCP limitation entirely
- Expected follow-up reply: contains `撤銷成功` or `已還原`

#### Group G — PURGE_EXPIRED

**G1 — Purge with no expired items**

- Input: `清理過期品`
- Expected: bot replies indicating no expired items, or shows the expiry list with no expired entries

#### Group H — SET_CONFIG

**H1 — Configure daily confirm schedule**

- Input: `設定每天晚上11點提醒`
- Expected: bot reply confirms schedule was set containing `排程` or `已設定`

#### Group I — App mention path

**I1 — @mention triggers handler**

- Input: `@life-helper-bot 查詢庫存` (format: `<@U0B46ML8MV2> 查詢庫存`)
- Expected: bot replies with inventory contents (confirms `app_mention` event path works)
- ⚠️ **Known behaviour**: in a private channel, both `message.groups` and `app_mention`
  events fire for an @mention, so the bot replies twice. This is expected and harmless.

---

## Step 5 — Report results

After all test cases complete, print the full summary table:

```
╔══════════════════════════════════════════════════════════════════════╗
║               life-helper Bot — E2E Test Results                    ║
╠══════╦══════════════════════════════════╦══════════╦═══════════════╣
║  ID  ║ Description                      ║  Status  ║ Notes         ║
╠══════╬══════════════════════════════════╬══════════╬═══════════════╣
║  A1  ║ SHOW_FEATURES                    ║  ✅ PASS ║               ║
║  A2  ║ QUERY_INVENTORY empty            ║  ✅ PASS ║               ║
...
╚══════╩══════════════════════════════════╩══════════╩═══════════════╝

Total: X passed / Y failed
```

If any test failed, list each failure with:

- The actual bot reply received (or "no reply")
- Why it was marked FAIL
- Suggested investigation step

If all pass:

> ✅ All E2E tests passed. The bot is working correctly on the Slack interface.

If any fail:

> ⚠️ X test(s) failed. Review the failures above before shipping.

---

## Adding new test cases

When a new feature or intent is added to the bot, add a new group (or extend an existing one) following this pattern:

1. Identify the intent name and the handler file (`src/handlers/<intent>.handler.ts`)
2. Add a test case in the appropriate group (or create Group J, K, … for new domains)
3. Cover: happy path, edge cases (empty data, invalid input), and any multi-step flows
4. If the feature introduces a new `ConversationFlow`, add a SESSION_INTERRUPT test for it
5. Update the summary table row count in the report template above

**Checklist for new test coverage:**

- [ ] Happy path with typical input
- [ ] Empty/no-data state (if applicable)
- [ ] Invalid or unexpected input
- [ ] Multi-step flow completion
- [ ] Multi-step flow abandonment (cancel)
- [ ] SESSION_INTERRUPT when triggered mid-flow (if flow is stateful)
