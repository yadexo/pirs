import "server-only";
import type { InstallBrowser, InstallClientOs, InstallPromptKind } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import type { NudgeHistory } from "@/lib/install-nudge";

/**
 * The server's half of the install nudge: what to remember, and the
 * per-clinic tally. The schedule itself is in lib/install-nudge.ts.
 *
 * Everything goes through the tenant-scoped client, so a clinic can only ever
 * read or write its own clients' rows.
 *
 * Scoped by `origin` as well as by clinic throughout. Installing from
 * login.deza.ai and from a clinic's own domain makes two different apps, with
 * their own icons and their own storage — so a client who said "don't ask
 * again" on one has said nothing at all about the other.
 */

/** What Home needs in order to decide whether, and how, to ask. */
export async function getNudgeHistory(db: TenantDb, customerProfileId: string, origin: string): Promise<NudgeHistory> {
  const [dismissals, never] = await Promise.all([
    db.installPromptEvent.aggregate({
      where: { customerProfileId, origin, kind: "DISMISSED" },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    db.installPromptEvent.findFirst({ where: { customerProfileId, origin, kind: "NEVER" }, select: { id: true } }),
  ]);
  return {
    dismissals: dismissals._count._all,
    lastDismissedAt: dismissals._max.createdAt?.toISOString() ?? null,
    neverAgain: never !== null,
  };
}

export interface InstallEventInput {
  tenantId: string;
  customerProfileId: string;
  kind: InstallPromptKind;
  os: InstallClientOs;
  browser: InstallBrowser;
  origin: string;
  stage: number;
}

/**
 * Writes one event, always.
 *
 * No read-then-write guard against duplicates, deliberately: two tabs, or an
 * `appinstalled` event landing in the same second as the first standalone
 * open, would race one anyway. The table stays append-only — which is what
 * the schedule reads — and the counts below ask for distinct clients instead
 * of summing rows, which is correct however many rows there are.
 */
export async function recordInstallEvent(db: TenantDb, event: InstallEventInput): Promise<void> {
  await db.installPromptEvent.create({ data: event });
}

export interface InstallStats {
  /** Clients who were shown the nudge at least once. */
  shown: number;
  /** Clients who tapped the button that starts an install. */
  started: number;
  /** Clients who have opened the installed app at least once. */
  installed: number;
}

/**
 * The clinic's tally, counted in clients rather than events.
 *
 * One person opening the installed app every morning is one install, not
 * three hundred — and counting distinct clients is also what makes the
 * missing duplicate guard above harmless.
 */
export async function getInstallStats(db: TenantDb, since?: Date): Promise<InstallStats> {
  const when = since ? { createdAt: { gte: since } } : {};
  const distinctClients = async (kind: InstallPromptKind | InstallPromptKind[]) => {
    const rows = await db.installPromptEvent.findMany({
      where: { ...when, kind: Array.isArray(kind) ? { in: kind } : kind },
      select: { customerProfileId: true },
      distinct: ["customerProfileId"],
    });
    return rows.length;
  };

  const [shown, started, installed] = await Promise.all([
    distinctClients("SHOWN"),
    distinctClients("STARTED"),
    // An install is "they opened it installed". ACCEPTED counts too, for the
    // browsers that say so — but it is not proof on its own: Chrome reports
    // an accepted prompt before the install has finished, and it also fires
    // for an install started from the browser's own menu.
    distinctClients(["OPENED", "ACCEPTED"]),
  ]);
  return { shown, started, installed };
}

/** Whether this client has ever opened the installed app on this address. */
export async function hasOpenedInstalled(db: TenantDb, customerProfileId: string, origin: string): Promise<boolean> {
  const row = await db.installPromptEvent.findFirst({
    where: { customerProfileId, origin, kind: "OPENED" },
    select: { id: true },
  });
  return row !== null;
}
