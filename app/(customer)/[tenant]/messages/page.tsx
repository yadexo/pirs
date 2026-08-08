import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { requireCustomerContext } from "@/lib/rbac";
import { getOrCreateConversationAction } from "@/lib/actions/messages";
import { formatDateTime, cn } from "@/lib/utils";
import { MessageForm } from "./message-form";

export default async function MessagesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const { db } = await requireCustomerContext();
  const conversationId = await getOrCreateConversationAction();
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    include: { messages: { where: { isInternalNote: false }, orderBy: { createdAt: "asc" } } },
  });

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col py-4 sm:h-[calc(100vh-6rem)]">
      <h1 className="mb-3 text-lg font-semibold">Messages</h1>
      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-surface-raised p-4">
        {conversation?.messages.length === 0 && (
          <p className="text-sm text-ink-muted">Send a message and our team will get back to you.</p>
        )}
        {conversation?.messages.map((m) => (
          <div key={m.id} className={cn("max-w-[75%] rounded-lg px-3 py-2 text-sm", m.senderType === "CUSTOMER" ? "ml-auto bg-brand-primary text-brand-primary-foreground" : "bg-surface-subtle text-ink")}>
            <p>{m.body}</p>
            <p className="mt-1 text-[10px] opacity-70">{formatDateTime(m.createdAt)}</p>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <MessageForm tenantSlug={tenantSlug} conversationId={conversationId} />
      </div>
    </div>
  );
}
