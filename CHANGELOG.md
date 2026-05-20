# Changelog

## v1.4.0 — 2026-05-20

### Bug Fixes

- clamp weekly consumption rate denominator to min 1 week — prevents absurd estimates (2607 onions/day) from logs recorded seconds apart (b149855)
- remove auto-inventory-deduction on no-reply to daily confirm; send reminder only (b149855)
- add `NluUnavailableError` for Anthropic HTTP 529 overloaded responses; increase maxRetries to 4; fix App Home action silently swallowing errors (5774de4)

### Other Changes

- update daily confirm footer: inventory will not auto-update if no reply (b149855)
- add D5, A5 e2e regression test notes for daily-confirm and NLU overload (38c7fa5, 2bf71d5)
- bump version to 1.4.0 (d1f2b5c)

## v1.3.1 — 2026-05-19

### Features

- Group batch consumption into one reversible session with timestamp display (cceafe5)

### Bug Fixes

- Prevent false error message when post-commit operations fail after consumption (6927b59)

### Other Changes

- Fix wrong working directory paths in skills and add D4/F2 e2e test cases (0ca4ce4)

## v1.3.0 — 2026-05-17

### Bug Fixes

- seed default categories via data migration so production inventory works on first deploy (2602bbd)

## v1.2.3 — 2026-05-17

### Features

- add App Home tab and route button actions to default channel (f45fa63)

## v1.2.2 — 2026-05-17

### Bug Fixes

- disable auto_stop_machines to keep cron bot always running — production machine stopped after v1.2.0 crash loop and cron notifications never fired (f254ce0)

## v1.2.1 — 2026-05-16

### Features

- replace all typed-keyword prompts with Block Kit buttons (完成 / 跳過 / 取消) across onboarding, restock, revert, and purge-expired flows (55d671f)

### Bug Fixes

- fix onboarding failing silently for large item batches — NLU max_tokens now scales by line count; compact JSON output format; ONBOARDING marked as free-form flow to bypass SESSION_INTERRUPT guard (8108f18)
- rename banner createRequire alias to avoid collision with slack-adapter ESM import (d7adde2)
- update stale test assertions for Block Kit button text changes (b92f6f9)

### Other Changes

- add reproduce-prod-issue skill (f4b716e)

## v1.2.0 — 2026-05-16

### Features

- add Slack as a second messaging interface via Socket Mode (a258b22)
- replace confirm/cancel text prompts with Block Kit buttons across all session flows (d30b167)
- add Block Kit buttons to revert flow; update e2e-test skill to use computer-use for button clicks (1eac10a)

### Bug Fixes

- store null expiry when user skips expiry date in restock flow (b943d95)
- update stale test assertions for Block Kit button text changes (b92f6f9)

### Other Changes

- add e2e-test skill (52af0e5)
- bump version to 1.2.0 (17afea8)

## v1.1.0 — 2026-05-15

### Features

- remove receipt image recognition feature — unreliable Vision API scanning replaced by text-only restock flow (075689e)
- aggregate receipt items by category, flag BOGO and unclear quantity (b2e458d)
- hint receipt upload option in restock session prompt (7fdfba7)

### Bug Fixes

- handle file messages so HEIC receipt uploads get a helpful reply (4720023)
- add createRequire banner to ESM bundle for CJS dependency compat (b9138be)
- switch tsup output to ESM to resolve import.meta crash on Fly.io (d15269c)

### Other Changes

- sync tsup config from main (ESM format + createRequire banner) (4160bb3)

## v1.0.1 — 2026-04-22

### Features

- push cron notifications to individual user chats (14cb2b7)
- make LINE_GROUP_ID optional — skip group push when absent (caf7173)

### Bug Fixes

- restore ESM bundle format and createRequire banner in tsup config (8fe54c6)

### Other Changes

- split env loading by environment, disable Sentry in dev (ea2adb6)

## v1.0.0 — 2026-04-22

First production release. All features developed across the full project lifecycle are included.

### Features

- add SHOW_FEATURES intent with LINE quick reply buttons (d725c71)
- add 清理過期 (purge-expired) feature (8b50ff7)
- implement SET_CONFIG handler, CronManager, and session conflict guard (9f22edf)
- include RESET_ITEM and PARTIAL_RESET in revert history (5e30d31)
- implement operation revert — list recent 10, pick & undo (d1d1c15)
- add partial inventory reset and fix restock cancellation (3b4a51a)
- ask for expiry date during restock when not provided (871892f)
- semantic unit validation via NLU — reject meaningless units per item (5a6dad3)
- implement inventory reset flow, expiry date onboarding, session guards (b8558b3)
- implement Phase 8 — tests, Sentry, Docker, Fly.io (f49056b)
- implement Phase 7 receipt photo recognition (0b450b9)
- implement Phase 6 daily confirmation & expiry tracking (abb2602)
- implement Phase 5 purchase reminder (948ad16)
- implement Phase 4 consumption tracking (6226c0d)
- implement Phase 3 inventory CRUD (9c9ce74)
- implement Phase 2 core bot architecture (c1b0be8)
- add Prisma schema, initial migration, and seed data (4c4e91b)

### Bug Fixes

- execute valid items before asking mismatch confirmation; support mismatch queue (474c9d2)
- ask confirmation when consumption specifies a non-existent expiry batch (9e439b0)
- merge addStock into existing batch when unit+expiryDate match (67dc4f0)
- sort listItems by earliest expiry date ascending (493d160)
- omit total quantity when item has batches with mixed units (9119783)
- reject past expiry dates during onboarding; skip check after reset (5cea412)
- re-prompt on unrecognized expiry date input; notify when using today's date (ce11e20)
- v0.2.0 — runtime fixes, unit conversion, input validation (5ffaff8)
- initialize Sentry before express via instrument.ts (3867c25)
- externalize @prisma/client in tsup bundle, target node22 (fe49523)

### Other Changes

- add README with setup and contributing guide (f2d6631)
