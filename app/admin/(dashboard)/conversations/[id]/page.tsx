import { notFound } from "next/navigation";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { formatDateTime, cn } from "@/lib/utils";
import { StaffMessageForm, ConversationControls, MarkReadOnMount } from "./client";

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("messages.send");
  const { db } = await requireStaffContext();
  const { id } = await params;

  const [conversation, staff] = await Promise.all([
    db.conversation.findFirst({
      where: { id },
      include: { customerProfile: true, messages: { orderBy: { createdAt: "asc" } } },
    }),
    db.staffProfile.findMany({ where: { active: true }, orderBy: { firstName: "asc" } }),
  ]);
  if (!conversation) notFound();

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col space-y-3">
      <MarkReadOnMount conversationId={id} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {conversation.customerProfile.firstName} {conversation.customerProfile.lastName}
          </h1>
          <p className="text-sm text-ink-subtle">{conversation.customerProfile.phone ?? ""}</p>
        </div>
        <ConversationControls
          conversationId={id}
          staff={staff}
          assignedStaffProfileId={conversation.assignedStaffProfileId}
          status={conversation.status}
        />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-surface-raised p-4">
        {conversation.messages.length === 0 && <p className="text-sm text-ink-muted">No messages yet.</p>}
        {conversation.messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[75%] rounded-lg px-3 py-2 text-sm",
              m.isInternalNote
                ? "border border-dashed border-warning bg-warning/5"
                : m.senderType === "STAFF"
                  ? "ml-auto bg-brand-primary text-brand-primary-foreground"
                  : "bg-surface-subtle text-ink",
            )}
          >
            {m.isInternalNote && <p className="mb-0.5 text-[10px] font-semibold uppercase text-warning">Internal note</p>}
            <p>{m.body}</p>
            <p className="mt-1 text-[10px] opacity-70">{formatDateTime(m.createdAt)}</p>
          </div>
        ))}
      </div>

      <StaffMessageForm conversationId={id} />
    </div>
  );
}
