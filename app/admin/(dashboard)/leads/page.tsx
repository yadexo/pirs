import Link from "next/link";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatDate } from "@/lib/utils";
import { UserPlus } from "lucide-react";
import { NewLeadForm, LeadStatusSelect } from "./client";

export default async function AdminLeadsPage() {
  await requirePermission("customers.view");
  const { db } = await requireStaffContext();

  const [leads, staff] = await Promise.all([
    db.lead.findMany({ include: { assignedStaffProfile: true }, orderBy: { createdAt: "desc" } }),
    db.staffProfile.findMany({ where: { active: true }, orderBy: { firstName: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Leads</h1>
        <NewLeadForm staff={staff} />
      </div>

      {leads.length === 0 ? (
        <EmptyState icon={<UserPlus className="h-6 w-6" />} title="No leads yet" />
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => (
            <Card key={lead.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <Link href={`/admin/leads/${lead.id}`} className="min-w-0">
                  <p className="font-medium hover:underline">{lead.name}</p>
                  <p className="text-xs text-ink-subtle">
                    {lead.source ?? "Unknown source"}
                    {lead.assignedStaffProfile ? ` · ${lead.assignedStaffProfile.firstName} ${lead.assignedStaffProfile.lastName}` : ""}
                    {lead.valueEstimateCents ? ` · ${formatMoney(lead.valueEstimateCents)}` : ""}
                    {lead.nextFollowUpAt ? ` · follow up ${formatDate(lead.nextFollowUpAt)}` : ""}
                  </p>
                </Link>
                <LeadStatusSelect leadId={lead.id} status={lead.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
