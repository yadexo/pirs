import { notFound, permanentRedirect } from "next/navigation";
import { rawDb } from "@/lib/db";

/**
 * The first customer app lived at /:tenant/*. It has been replaced by the
 * client app at /app/:merchantSlug, so bookmarks, QR codes and emailed links
 * pointing at the old URLs are sent to the closest screen there.
 *
 * This is a page rather than middleware because only the database can tell a
 * real clinic slug from a mistyped path — anything else is a genuine 404.
 */
const OLD_TO_NEW: Record<string, string> = {
  services: "/shop?tab=treatments",
  packages: "/shop",
  products: "/shop",
  promotions: "/shop",
  basket: "/shop",
  checkout: "/shop",
  memberships: "/shop?tab=memberships",
  loyalty: "/rewards",
  account: "/profile?tab=settings",
  appointments: "/profile",
  orders: "/profile",
  notifications: "/profile?tab=settings",
  messages: "/profile",
};

export default async function LegacyCustomerRedirect({
  params,
}: {
  params: Promise<{ tenant: string; rest?: string[] }>;
}) {
  const { tenant: slug, rest = [] } = await params;

  const tenant = await rawDb.tenant.findUnique({ where: { slug }, select: { slug: true } });
  if (!tenant) notFound();

  permanentRedirect(`/app/${tenant.slug}${OLD_TO_NEW[rest[0] ?? ""] ?? ""}`);
}
