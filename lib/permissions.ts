export const PERMISSIONS = [
  { key: "customers.view", label: "View customers", category: "Customers" },
  { key: "customers.edit", label: "Edit customers", category: "Customers" },
  { key: "appointments.manage", label: "Manage appointments", category: "Appointments" },
  { key: "sales.manage", label: "Manage sales", category: "Sales" },
  { key: "loyalty.adjust", label: "Adjust loyalty points", category: "Loyalty" },
  { key: "messages.send", label: "Send messages", category: "Messaging" },
  { key: "promotions.create", label: "Create promotions", category: "Promotions" },
  { key: "analytics.view", label: "View analytics", category: "Analytics" },
  { key: "memberships.manage", label: "Manage memberships", category: "Memberships" },
  { key: "catalog.manage", label: "Manage products, services and plans", category: "Catalog" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as string[]).includes(value);
}
