# life-helper E2E Test Configuration

## Project Info

- **Name**: life-helper Bot
- **Root**: /Users/xfreddy2007/Documents/Self-projects/life-helper

---

## Prerequisites

- Docker is installed and running
  ```bash
  docker info > /dev/null 2>&1 && echo "OK" || echo "FAIL: Docker not running"
  ```
- `apps/bot/.env.local` exists with valid credentials
  ```bash
  test -f /Users/xfreddy2007/Documents/Self-projects/life-helper/apps/bot/.env.local && echo "OK" || echo "FAIL: .env.local missing"
  ```
- Slack MCP is authenticated (run `/mcp` → "claude.ai Slack" if not already connected)

---

## Infrastructure Setup

### Step 1 — Reset Docker containers

Find and kill any existing containers for this project:

```bash
docker compose -f /Users/xfreddy2007/Documents/Self-projects/life-helper/docker-compose.yml down 2>&1
rm -rf /Users/xfreddy2007/Documents/Self-projects/life-helper/db-data
```

Start fresh containers:

```bash
docker compose -f /Users/xfreddy2007/Documents/Self-projects/life-helper/docker-compose.yml up -d 2>&1
```

Poll until both Postgres and Redis are healthy (up to 60 s):

```bash
until docker compose -f /Users/xfreddy2007/Documents/Self-projects/life-helper/docker-compose.yml ps | grep -E "postgres|redis" | grep -v "healthy" | wc -l | grep -q "^0$"; do
  sleep 2
done
```

### Step 2 — DB migrations and seed

```bash
cd /Users/xfreddy2007/Documents/Self-projects/life-helper/packages/database && \
  DATABASE_URL="postgresql://lifehelper:lifehelper_dev@localhost:5432/life_helper" \
  npx prisma migrate deploy 2>&1
```

```bash
cd /Users/xfreddy2007/Documents/Self-projects/life-helper/packages/database && \
  DATABASE_URL="postgresql://lifehelper:lifehelper_dev@localhost:5432/life_helper" \
  npx tsx prisma/seed/seed.ts 2>&1
```

### Step 3 — Start dev server

Kill stale processes:

```bash
pkill -f "tsx.*main.ts" 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null; sleep 1
```

Start in background:

```bash
cd /Users/xfreddy2007/Documents/Self-projects/life-helper && npx tsx apps/bot/src/main.ts > /tmp/life-helper-dev.log 2>&1 &
echo $! > /tmp/life-helper-dev.pid
```

Poll health (up to 30 s):

```bash
until curl -sf http://localhost:3000/health > /dev/null 2>&1; do sleep 2; done
```

If not up after 30 s:

```bash
tail -30 /tmp/life-helper-dev.log
```

---

## Phase Detection

- **Phase: always** — no check needed; all groups declared `always` are always active.
- **Phase: has-inventory** — check if Postgres has any inventory rows (set by Group B):
  ```bash
  # evaluated dynamically after Group B completes; active if B2 or B3 passed
  ```

All groups in this project are declared `always` — they rely on sequential state setup within the run.

---

## Test Groups

Each test case uses the Slack MCP:

1. Send input to channel `C0B3WP0V64B` via `slack_send_message`
2. Wait **8 seconds** (NLU takes ~3–5 s)
3. Read last 2 messages via `slack_read_channel` (limit=2, response_format=concise)
4. Verify bot (`life-helper-bot`) replied with expected content

### Block Kit Button Click Procedure

When a step is marked `[BUTTON CLICK: 確認]` or `[BUTTON CLICK: 取消]`:

1. Load computer-use tools via `ToolSearch` with `query: "computer-use", max_results: 30`
2. Call `request_access` with `applications: ["Slack"]`
3. Call `open_application` with `name: "Slack"`
4. Call `screenshot` to capture screen
5. Locate the button in the most recent bot message
6. Call `left_click` at the button's pixel coordinates
7. Wait 5 s, then `slack_read_channel` (limit=2) to verify response

---

### Group A — Single-turn intents (Phase: always)

**A1 — SHOW_FEATURES**

- Input: `功能選單`
- Expected: bot replies containing `居家生活小幫手` and at least 5 feature button labels (庫存盤點, 查詢庫存, 記錄消耗, 補充庫存, 採購清單)

**A2 — QUERY_INVENTORY (empty DB)**

- Input: `查詢庫存`
- Expected: bot replies containing `尚無庫存資料`

**A3 — UNKNOWN intent**

- Input: `今天天氣怎麼樣`
- Expected: bot replies containing `不太明白` or `您可以說`

**A4 — QUERY_PURCHASE_LIST (empty)**

- Input: `採購清單`
- Expected: bot replies (any non-error response about purchase list)

**A5 — NLU overload regression guard**

- Note: cannot simulate HTTP 529 in e2e; verify via log inspection after any bot reply
- Check: `grep -c "NluUnavailableError" /tmp/life-helper-dev.log` should output `0`
- If bot ever returns `AI 服務暫時忙碌`, that is correct error handling — not a code bug

---

### Group B — RESTOCK flow (Phase: always)

**B1 — Unit mismatch detection**

- Input: `補充庫存 白米 2 包`
- Expected: bot reply contains `單位` and `不太合理` — item NOT saved

**B2 — Correct unit, no expiry**

- Input: `補充庫存 白米 2 kg`
- Expected: bot asks for expiry date containing `到期日`
- Follow-up input: `跳過`
- Expected: `補貨完成` and `白米 +2kg`

**B3 — Correct unit, with expiry date**

- Input: `補充庫存 橄欖油 500 ml`
- Expected: bot asks for expiry date
- Follow-up input: `2026/12`
- Expected: `補貨完成` and `橄欖油` and `2026/12`

---

### Group C — QUERY_INVENTORY with items (Phase: always, depends on B2/B3)

**C1 — List all inventory**

- Input: `查詢庫存`
- Expected: bot reply contains `白米` and `橄欖油` and a quantity

**C2 — Query specific item**

- Input: `白米還有多少`
- Expected: bot reply contains `白米` and a quantity in `kg`

---

### Group D — RECORD_CONSUMPTION flow (Phase: always, depends on B2/B3)

**D1 — Normal consumption**

- Input: `今天用了白米 0.5 kg`
- Expected: bot reply contains `消耗記錄完成` and `白米 -0.5kg`

**D2a — Consumption exceeding available stock**

- Input: `用了白米 100 kg`
- Expected: bot reply contains `目前庫存只有` and `請確認數量是否正確` — nothing recorded, no session opened
- Note: the stock check in `record-consumption.handler.ts` runs _before_ anomaly detection, so any
  quantity above current stock hits this guard and can never reach the anomaly path

**D2b — Anomaly detection (within stock, abnormal vs history)**

- Pre-condition: 白米 stock is 1.5kg and recent logs are ~0.5kg (state after D1)
- Input: `用了白米 1.4 kg`
- Expected: bot reply contains `確認要記錄嗎` with Block Kit 確認/取消 buttons
- Follow-up: `[BUTTON CLICK: 取消]` (or type `取消`)
- Expected: `已取消，消耗未記錄`
- Note: quantity must stay at or below current stock, otherwise D2a's guard fires first

**D3 — Query after consumption**

- Input: `白米還有多少`
- Expected: bot reply contains `白米` with quantity less than pre-consumption amount

**D4 — Batch consumption + revert list grouping**

- Input: `今天消耗：橄欖油 50ml、白米 200g`
- Expected: `消耗記錄完成` and `橄欖油 -50ml` and `白米 -200g`
- Follow-up input: `撤銷操作`
- Expected: first entry in list contains `消耗批次（2 項）` with timestamp prefix and both item names
- Follow-up input: `取消` (abort revert — preserves state for F2)
- Expected: `已取消撤銷操作`

**D5 — Daily confirm message regression guard**

- Check the last scheduled message in channel `C0B3WP0V64B`
- Expected: footer contains `庫存將不會自動更新` and does NOT contain `自動套用預估值`

---

### Group E — SESSION_INTERRUPT (Phase: always)

**E1 — Interrupt mid-onboarding**

- Input: `開始盤點`
- Expected: onboarding flow starts with Block Kit 確認/取消 buttons
- Interrupt input: `補充庫存 衛生紙 3 包`
- Expected: contains `正在進行中` with Block Kit 確認/取消 buttons
- Resolution: `[BUTTON CLICK: 取消]`
- Expected: `已繼續` or `繼續目前操作`
- Abort: `[BUTTON CLICK: 取消]` on original RESET_CONFIRM message (or type `取消` if buttons removed)
- Expected: `已取消，庫存未變動`

**E2 — Interrupt with passthrough**

- Input: `開始盤點`
- Expected: RESET_CONFIRM prompt with Block Kit 確認/取消 buttons
- Interrupt input: `查詢庫存`
- Expected: bot answers with the inventory listing (`目前庫存`), NOT the conflict guard (`正在進行中`)
  and NOT the flow re-prompt (`請選擇「確認」清除並重新盤點`)
- Expected: reply ends with a reminder containing `全量庫存重置確認` and `仍在進行中`
- Cleanup: `取消` → `已取消，庫存未變動`
- Note: read-only intents are dispatched ahead of the flow blocks in `intent-router.ts`; the active
  session is left untouched so the user can resume

**E3 — Onboarding keeps its own query re-prompt**

- Input: `開始盤點`, then `[BUTTON CLICK: 確認]` to enter the ONBOARDING flow
- Interrupt input: `查詢庫存`
- Expected: `盤點正在進行中` re-prompt — ONBOARDING is deliberately excluded from read-only passthrough
- Cleanup: `完成` to end the stocktake

---

### Group F — REVERT_OPERATION (Phase: always, depends on D)

**F1 — Undo last consumption**

- Input: `撤銷操作`
- Expected: bot lists recent operations (contains `白米` or a log entry)
- Follow-up input: the number of the **single-item** consumption entry — `消耗 白米 -0.5kg` from D1
  - After D4 the newest entry (`1`) is the multi-item `消耗批次（2 項）`, which belongs to F2.
    Selecting it here yields `批次撤銷完成（2 項）` instead of the single-op message below.
  - With the D1–D4 sequence intact this is entry `2`; confirm against the actual listing before replying
  - Note: Slack MCP appends `*發送工具* Claude` to messages; `parseInt` still extracts the leading digit correctly
- Expected: bot shows confirmation `確認要撤銷：…` with Block Kit 確認/取消 buttons
- Follow-up: `[BUTTON CLICK: 確認]`
  - Note: button sends exact `"確認"` string without MCP suffix
- Expected: contains `已撤銷消耗` or `已撤銷補貨`

**F2 — Batch revert (multi-item)**

- Pre-condition: `今天消耗：橄欖油 50ml、白米 200g`
- Expected: `消耗記錄完成` with both items
- Input: `撤銷操作`
- Expected: first entry contains `消耗批次` and both item names with timestamp prefix e.g. `[MM/DD HH:mm] 消耗批次（2 項）：橄欖油 -50ml、白米 -200g`
- Follow-up input: `1`
- Expected: confirmation `確認要撤銷：「[…] 消耗批次（2 項）…」` with Block Kit buttons
- Follow-up: `確認` or `[BUTTON CLICK: 確認]`
- Expected: `批次撤銷完成（2 項）` and both restored quantities

---

### Group G — PURGE_EXPIRED (Phase: always)

**G1 — Purge with no expired items**

- Input: `清理過期品`
- Expected: bot replies indicating no expired items or shows expiry list with no expired entries

---

### Group H — SET_CONFIG (Phase: always)

**H1 — Configure daily confirm schedule**

- Input: `設定每天晚上11點提醒`
- Expected: bot reply confirms schedule set, containing `排程` or `已設定`

---

### Group I — App mention path (Phase: always)

**I1 — @mention triggers handler**

- Input: `<@U0B46ML8MV2> 查詢庫存`
- Expected: bot replies with inventory contents (confirms `app_mention` event path works)
- Known behaviour: in private channel, both `message.groups` and `app_mention` events fire for @mention — bot replies twice; this is expected and harmless

---

## Adding New Test Cases

1. Add a new test case to the appropriate group, or create a new group (J, K, …)
2. Follow the test case format used in groups A–I above
3. Cover: happy path, edge cases (empty data, invalid input), multi-step completion, multi-step abandonment
4. If feature introduces a new `ConversationFlow`, add SESSION_INTERRUPT test (Group E pattern)

**Checklist for new test coverage:**

- [ ] Happy path with typical input
- [ ] Empty/no-data state (if applicable)
- [ ] Invalid or unexpected input
- [ ] Multi-step flow completion
- [ ] Multi-step flow abandonment (cancel)
- [ ] SESSION_INTERRUPT when triggered mid-flow (if stateful)
