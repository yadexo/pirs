import "server-only";
import type { NotificationPromptKind, NotificationPromptSurface } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import type { PromptHistory } from "@/lib/notification-prompt";

/**
 * The server's half of the notifications prompt: what to remember, and the
 * per-clinic tally. The schedule itself lives in lib/notification-prompt.ts.
 *
 * Everything goes through the tenant-scoped client, so a clinic can only ever
 * read or write its own clients' rows.
 */

/** The two answers that mean "no": the client's own, and the device's. */
const DECLINE_KINDS: NotificationPromptKind[] = ["NOT_NOW", "BLOCKED"];

/** What the Home page needs to decide whether, and how, to ask. */
export async function getPromptHistory(db: TenantDb, customerProfileId: string): Promise<PromptHistory> {
  const [declines, profile] = await Promise.all([
    db.notificationPromptEvent.aggregate({
      where: { customerProfileId, kind: { in: DECLINE_KINDS } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    db.customerProfile.findFirst({ where: { id: customerProfileId }, select: { marketingConsentChosenAt: true } }),
  ]);
  return {
    declines: declines._count._all,
    lastDeclinedAt: declines._max.createdAt?.toISOString() ?? null,
    // Set only by the client's own choices, which is exactly "has decided".
    offersDecided: profile?.marketingConsentChosenAt != null,
  };
}

export interface PromptEventInput {
  tenantId: string;
  customerProfileId: string;
  kind: NotificationPromptKind;
  surface: NotificationPromptSurface;
  stage: number;
}

/**
 * Writes one event. "Shown" is written at most once per client, surface and
 * step of the schedule: Home is opened many times, and counting each would
 * make a card that sat there for a week look like a week of impressions.
 */
export async function recordPromptEvent(db: TenantDb, event: PromptEventInput): Promise<{ recorded: boolean }> {
  if (event.kind === "SHOWN") {
    const already = await db.notificationPromptEvent.findFirst({
      where: { customerProfileId: event.customerProfileId, kind: "SHOWN", surface: event.surface, stage: event.stage },
      select: { id: true },
    });
    if (already) return { recorded: false };
  }
  await db.notificationPromptEvent.create({ data: event });
  return { recorded: true };
}

export interface PromptStats {
  shown: number;
  turnedOn: number;
  /** "Not now" plus device-level denials. */
  declined: number;
}

/** This clinic's tally of the prompt, from the start or from `since`. */
export async function getPromptStats(db: TenantDb, since?: Date): Promise<PromptStats> {
  const rows = await db.notificationPromptEvent.groupBy({
    by: ["kind"],
    where: since ? { createdAt: { gte: since } } : {},
    _count: { _all: true },
  });
  const count = (kinds: NotificationPromptKind[]) => rows.filter((r) => kinds.includes(r.kind)).reduce((sum, r) => sum + r._count._all, 0);
  return { shown: count(["SHOWN"]), turnedOn: count(["TURNED_ON"]), declined: count(DECLINE_KINDS) };
}
