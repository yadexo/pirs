import { notFound } from "next/navigation";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDate, formatDateTime } from "@/lib/utils";
import { NoteForm, AdjustCreditForm, AdjustPointsForm, TagPicker } from "./client";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.view");
  const { db } = await requireStaffContext();
  const { id } = await params;

  const [customer, allTags] = await Promise.all([
    db.customerProfile.findFirst({
      where: { id },
      include: {
        user: true,
        tags: { include: { tag: true } },
        notes: { orderBy: { createdAt: "desc" }, include: { authorStaffProfile: true } },
        orders: { orderBy: { placedAt: "desc" }, take: 10 },
        appointments: { orderBy: { startAt: "desc" }, take: 10, include: { service: true } },
        memberships: { include: { membershipPlan: true }, orderBy: { createdAt: "desc" } },
        loyaltyTx: { orderBy: { createdAt: "desc" }, take: 10 },
        creditTx: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    }),
    db.customerTag.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!customer) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">
          {customer.firstName} {customer.lastName}
        </h1>
        <p className="text-sm text-ink-subtle">{customer.user.email} {customer.phone ? `· ${customer.phone}` : ""}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
        </CardHeader>
        <CardContent>
          <TagPicker customerProfileId={customer.id} allTags={allTags} appliedTagIds={customer.tags.map((t) => t.tagId)} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Date of birth: {customer.dateOfBirth ? formatDate(customer.dateOfBirth) : "—"}</p>
            <p>Address: {[customer.addressLine1, customer.city, customer.region].filter(Boolean).join(", ") || "—"}</p>
            <p className="flex items-center gap-1.5">
              Marketing consent: <Badge tone={customer.marketingConsent ? "success" : "neutral"}>{customer.marketingConsent ? "Yes" : "No"}</Badge>
            </p>
            <p>Customer since {formatDate(customer.createdAt)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Membership</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {customer.memberships.length === 0 ? (
              <p className="text-ink-muted">No membership history.</p>
            ) : (
              customer.memberships.map((m) => (
                <div key={m.id} className="flex items-center justify-between">
                  <span>{m.membershipPlan.name}</span>
                  <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Loyalty — {customer.loyaltyPointsBalance} pts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AdjustPointsForm customerProfileId={customer.id} />
            <div className="space-y-1 border-t border-border pt-2 text-sm">
              {customer.loyaltyTx.map((tx) => (
                <div key={tx.id} className="flex justify-between text-ink-muted">
                  <span>{tx.reason ?? tx.type}</span>
                  <span className={tx.points >= 0 ? "text-success" : "text-danger"}>{tx.points >= 0 ? "+" : ""}{tx.points}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account credit — {formatMoney(customer.accountCreditBalanceCents)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AdjustCreditForm customerProfileId={customer.id} />
            <div className="space-y-1 border-t border-border pt-2 text-sm">
              {customer.creditTx.map((tx) => (
                <div key={tx.id} className="flex justify-between text-ink-muted">
                  <span>{tx.reason ?? tx.type}</span>
                  <span className={tx.amountCents >= 0 ? "text-success" : "text-danger"}>{formatMoney(tx.amountCents)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {customer.orders.length === 0 ? (
              <p className="text-ink-muted">No orders yet.</p>
            ) : (
              customer.orders.map((o) => (
                <div key={o.id} className="flex justify-between">
                  <span>{o.orderNumber}</span>
                  <span>{formatMoney(o.totalCents)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appointments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {customer.appointments.length === 0 ? (
              <p className="text-ink-muted">No appointments yet.</p>
            ) : (
              customer.appointments.map((a) => (
                <div key={a.id} className="flex justify-between">
                  <span>{a.service.name}</span>
                  <span className="text-ink-subtle">{formatDate(a.startAt)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Internal notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <NoteForm customerProfileId={customer.id} />
          <div className="space-y-2 border-t border-border pt-3">
            {customer.notes.length === 0 && <p className="text-sm text-ink-muted">No notes yet.</p>}
            {customer.notes.map((note) => (
              <div key={note.id} className="text-sm">
                <p>{note.body}</p>
                <p className="text-xs text-ink-subtle">
                  {note.authorStaffProfile ? `${note.authorStaffProfile.firstName} ${note.authorStaffProfile.lastName}` : "Staff"} ·{" "}
                  {formatDateTime(note.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
