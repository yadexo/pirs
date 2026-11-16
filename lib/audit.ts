import "server-only";
import type { Prisma } from "@prisma/client";
import { rawDb } from "@/lib/db";

export async function writeAuditLog(
  entry: {
    tenantId: string | null;
    actorUserId: string | null;
    actorType: "PLATFORM_ADMIN" | "STAFF" | "SYSTEM";
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    reason?: string;
  },
  /** Inside a transaction, so the audit row stands or falls with the change it records. */
  tx: Prisma.TransactionClient = rawDb,
) {
  await tx.auditLog.create({
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
