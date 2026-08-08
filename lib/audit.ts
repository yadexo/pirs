import "server-only";
import { rawDb } from "@/lib/db";

export async function writeAuditLog(entry: {
  tenantId: string | null;
  actorUserId: string | null;
  actorType: "PLATFORM_ADMIN" | "STAFF" | "SYSTEM";
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  reason?: string;
}) {
  await rawDb.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorUserId: entry.actorUserId,
      actorType: entry.actorType,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata as never,
      reason: entry.reason,
    },
  });
}
