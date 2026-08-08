import Link from "next/link";
import { requireStaffContext, requirePermission } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";
import { MessagesSquare } from "lucide-react";

export default async function AdminConversationsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("messages.send");
  const { db } = await requireStaffContext();
  const { q } = await searchParams;

  const conversations = await db.conversation.findMany({
    where: q
      ? { customerProfile: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } }
      : undefined,
    include: { customerProfile: true, assignedStaffProfile: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Conversations</h1>

      {conversations.length === 0 ? (
        <EmptyState icon={<MessagesSquare className="h-6 w-6" />} title="No conversations yet" />
      ) : (
        <div className="space-y-2">
          {conversations.map((c) => (
            <Link key={c.id} href={`/admin/conversations/${c.id}`}>
              <Card className={c.unreadForStaff ? "border-brand-primary/40 bg-brand-primary/5" : ""}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.customerProfile.firstName} {c.customerProfile.lastName}
                    </p>
                    <p className="truncate text-xs text-ink-subtle">
                      {c.messages[0]?.body ?? "No messages yet"} · {formatDateTime(c.lastMessageAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.unreadForStaff && <Badge tone="brand">New</Badge>}
                    <Badge tone={c.status === "OPEN" ? "success" : c.status === "PENDING" ? "warning" : "neutral"}>{c.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
