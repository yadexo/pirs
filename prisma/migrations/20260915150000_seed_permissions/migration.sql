-- Permissions are reference data the application needs in every database,
-- not demo data: without these rows no clinic can create a role that grants
-- anything. They were previously only created by the demo seed script.
-- tests/integration/permissions.test.ts fails if lib/permissions.ts gains a key
-- that no migration inserts.
INSERT INTO "Permission" ("id", "key", "label", "category") VALUES
  ('perm_customers_view', 'customers.view', 'View customers', 'Customers'),
  ('perm_customers_edit', 'customers.edit', 'Edit customers', 'Customers'),
  ('perm_appointments_manage', 'appointments.manage', 'Manage appointments', 'Appointments'),
  ('perm_sales_manage', 'sales.manage', 'Manage sales', 'Sales'),
  ('perm_loyalty_adjust', 'loyalty.adjust', 'Adjust loyalty points', 'Loyalty'),
  ('perm_messages_send', 'messages.send', 'Send messages', 'Messaging'),
  ('perm_promotions_create', 'promotions.create', 'Create promotions', 'Promotions'),
  ('perm_analytics_view', 'analytics.view', 'View analytics', 'Analytics'),
  ('perm_memberships_manage', 'memberships.manage', 'Manage memberships', 'Memberships'),
  ('perm_catalog_manage', 'catalog.manage', 'Manage products, services and plans', 'Catalog')
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "category" = EXCLUDED."category";
