# Changelog

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
