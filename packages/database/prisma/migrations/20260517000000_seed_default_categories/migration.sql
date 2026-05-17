-- Seed default categories once. ON CONFLICT DO NOTHING makes this idempotent
-- in case the row already exists (e.g. local dev where seed was run manually).
-- IDs use gen_random_uuid() cast to text; the app never hard-codes category IDs
-- so any stable unique value works.
INSERT INTO "Category" ("id", "name", "isDefault", "defaultExpiryAlertDays", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, '食材',      true,  3, NOW(), NOW()),
  (gen_random_uuid()::text, '調味料',    true,  7, NOW(), NOW()),
  (gen_random_uuid()::text, '飲料',      true, 14, NOW(), NOW()),
  (gen_random_uuid()::text, '零食',      true, 14, NOW(), NOW()),
  (gen_random_uuid()::text, '清潔用品',  true, 30, NOW(), NOW()),
  (gen_random_uuid()::text, '衛生用品',  true, 30, NOW(), NOW()),
  (gen_random_uuid()::text, '罐頭/乾貨', true, 14, NOW(), NOW()),
  (gen_random_uuid()::text, '冷凍食品',  true,  7, NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;
