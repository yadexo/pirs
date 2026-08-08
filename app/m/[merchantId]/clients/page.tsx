import { requireMerchantContext } from "@/lib/merchant-context";
import { MerchantPageHeader } from "@/components/merchant/page-header";
import { ClientsTable } from "./clients-table";

const PAGE_SIZE = 25;

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string }>;
  searchParams: Promise<{ q?: string; sort?: string; status?: string; page?: string }>;
}) {
  const { merchantId } = await params;
  const { q = "", sort = "alphabetical", status = "all", page = "1" } = await searchParams;
  const ctx = await requireMerchantContext(merchantId);

  const pageNum = Math.max(1, Number(page) || 1);

  // Leads are clients with no completed activity — the old Leads page is now
  // a filter here rather than a second table.
  const where = {
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(status === "lead" ? { visitCount: { equals: 0 } } : {}),
    ...(status === "client" ? { visitCount: { gt: 0 } } : {}),
  };

  const orderBy =
    sort === "newest"
      ? { createdAt: "desc" as const }
      : sort === "visits"
        ? { visitCount: "desc" as const }
        : sort === "last-visit"
          ? { lastVisitAt: "desc" as const }
          : { firstName: "asc" as const };

  const [rows, total] = await Promise.all([
    ctx.db.customerProfile.findMany({
      where,
      orderBy,
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { email: true } },
        memberships: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 },
      },
    }),
    ctx.db.customerProfile.count({ where }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <MerchantPageHeader title="Client Profiles" merchantName={ctx.merchantName} />
      <div className="mt-5">
        <ClientsTable
          merchantId={merchantId}
          q={q}
          sort={sort}
          status={status}
          page={pageNum}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          rows={rows.map((r) => ({
            id: r.id,
            name: `${r.firstName} ${r.lastName}`.trim(),
            phone: r.phone,
            email: r.user.email,
            visits: r.visitCount,
            lastVisit: r.lastVisitAt?.toISOString() ?? null,
            joined: r.createdAt.toISOString(),
            isMember: r.memberships.length > 0,
            points: r.loyaltyPointsBalance,
            creditCents: r.accountCreditBalanceCents,
          }))}
        />
      </div>
    </div>
  );
}
