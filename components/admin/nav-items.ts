import type { PermissionKey } from "@/lib/permissions";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  CalendarDays,
  CalendarRange,
  Layers,
  Package,
  Boxes,
  CreditCard,
  Gift,
  Tag,
  ShoppingCart,
  Wallet,
  MessagesSquare,
  BellRing,
  UserCog,
  MapPin,
  BarChart3,
  Palette,
  Settings,
  ScrollText,
} from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: PermissionKey;
  tenantAdminOnly?: boolean;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/customers", label: "Customers", icon: Users, permission: "customers.view" },
  { href: "/admin/leads", label: "Leads", icon: UserPlus, permission: "customers.view" },
  { href: "/admin/appointments", label: "Appointments", icon: CalendarDays, permission: "appointments.manage" },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarRange, permission: "appointments.manage" },
  { href: "/admin/services", label: "Services", icon: Layers, permission: "sales.manage" },
  { href: "/admin/products", label: "Products", icon: Package, permission: "sales.manage" },
  { href: "/admin/packages", label: "Packages", icon: Boxes, permission: "sales.manage" },
  { href: "/admin/memberships", label: "Memberships", icon: CreditCard, permission: "memberships.manage" },
  { href: "/admin/loyalty", label: "Loyalty", icon: Gift, permission: "loyalty.adjust" },
  { href: "/admin/promotions", label: "Promotions", icon: Tag, permission: "promotions.create" },
  { href: "/admin/orders", label: "Orders", icon: ShoppingCart, permission: "sales.manage" },
  { href: "/admin/payments", label: "Payments", icon: Wallet, permission: "sales.manage" },
  { href: "/admin/conversations", label: "Conversations", icon: MessagesSquare, permission: "messages.send" },
  { href: "/admin/notifications", label: "Notification campaigns", icon: BellRing, permission: "promotions.create" },
  { href: "/admin/staff", label: "Staff", icon: UserCog, tenantAdminOnly: true },
  { href: "/admin/locations", label: "Locations", icon: MapPin, tenantAdminOnly: true },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.view" },
  { href: "/admin/branding", label: "Branding", icon: Palette, tenantAdminOnly: true },
  { href: "/admin/settings", label: "Settings", icon: Settings, tenantAdminOnly: true },
  { href: "/admin/audit-log", label: "Audit log", icon: ScrollText, tenantAdminOnly: true },
];
