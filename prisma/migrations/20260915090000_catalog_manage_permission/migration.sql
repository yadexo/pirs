-- Permissions are global rows seeded from lib/permissions.ts. Add the new key
-- to databases that were seeded before it existed. The id only needs to be
-- unique; the application looks permissions up by key.
INSERT INTO "Permission" ("id", "key", "label", "category")
VALUES ('perm_catalog_manage', 'catalog.manage', 'Manage products, services and plans', 'Catalog')
ON CONFLICT ("key") DO NOTHING;
