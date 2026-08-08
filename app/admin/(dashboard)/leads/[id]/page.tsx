import { notFound } from "next/navigation";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { addLeadNoteAction } from "@/lib/actions/leads";
import { LeadStatusSelect, ConvertLeadButton } from "../client";
import { LeadNoteFormClient } from "./client";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.view");
  const { db } = await requireStaffContext();
  const { id } = await params;

  const lead = await db.lead.findFirst({ where: { id }, include: { assignedStaffProfile: true } });
  if (!lead) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{lead.name}</h1>
          <p className="text-sm text-ink-subtle">
            Created {formatDate(lead.createdAt)}
            {lead.assignedStaffProfile ? ` · Assigned to ${lead.assignedStaffProfile.firstName} ${lead.assignedStaffProfile.lastName}` : ""}
          </p>
        </div>
        <LeadStatusSelect leadId={lead.id} status={lead.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contact details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Email: {lead.email ?? "—"}</p>
          <p>Phone: {lead.phone ?? "—"}</p>
          <p>Source: {lead.source ?? "—"}</p>
          <div className="pt-2">
            <ConvertLeadButton leadId={lead.id} hasEmail={!!lead.email} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes & follow-up</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadNoteFormClient action={addLeadNoteAction.bind(null, lead.id)} currentNotes={lead.notes} />
        </CardContent>
      </Card>
    </div>
  );
}
