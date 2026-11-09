"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { rawDb } from "@/lib/db";
import { ActionError, runAction, type ActionResult } from "@/lib/merchant-action";
import { requirePlatformAdminAction } from "@/lib/platform-admin-action";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { checkClinicDomain, dnsRecordsFor, refusalMessage, type DnsRecord, type VercelVerificationChallenge } from "@/lib/clinic-domain";
import { describeError, vercelConfig, vercelDomainsApi, type VercelDomainsApi } from "@/lib/vercel-domains";
import { logDomain } from "@/lib/signin-log";
import { forgetClinicHosts } from "@/lib/clinic-hosts";

/**
 * Attaching, re-checking and removing a clinic's own domain.
 *
 * Every one of these is a platform-admin action: the right role, two-factor
 * confirmed, and not mid-impersonation — checked server-side by
 * requirePlatformAdminAction whatever the console showed.
 *
 * Order matters in attach and in remove. Vercel is the side we cannot roll
 * back, so it goes first and the row follows: a domain on the project with no
 * row is invisible but harmless, while a row with no domain on the project
 * would promise routing that does not exist.
 */

/** Per admin, per hour. Generous for real use; it is a loop this stops. */
const ATTACHES_PER_HOUR = 10;
const CHECKS_PER_HOUR = 60;

function api(): VercelDomainsApi {
  const config = vercelConfig();
  if (!config) {
    logDomain("not_configured");
    throw new ActionError("Custom domains are not set up on this deployment: VERCEL_API_TOKEN and VERCEL_PROJECT_ID have to be set.");
  }
  return vercelDomainsApi(config);
}

/** What the panel renders, after any of the three actions. */
export interface DomainView {
  host: string;
  status: "PENDING" | "VERIFIED" | "FAILED";
  records: DnsRecord[];
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}

interface DomainRow {
  host: string;
  status: string;
  verification: unknown;
  lastCheckedAt: Date | null;
  verifiedAt: Date | null;
  lastError: string | null;
}

function view(row: DomainRow): DomainView {
  const challenges = asChallenges(row.verification);
  return {
    host: row.host,
    status: row.status as DomainView["status"],
    records: dnsRecordsFor(row.host, challenges),
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

/** Vercel's challenges, stored in its own shape: we print them, never interpret them. */
const asJson = (challenges: VercelVerificationChallenge[]) => challenges as unknown as Prisma.InputJsonValue;
const asChallenges = (value: unknown): VercelVerificationChallenge[] => (Array.isArray(value) ? (value as unknown as VercelVerificationChallenge[]) : []);

const clientDomainOf = (tenantId: string) => ({ tenantId_type: { tenantId, type: "CLIENT" as const } });

export async function attachClinicDomainAction(merchantId: string, fd: FormData): Promise<ActionResult<{ domain: DomainView }>> {
  return runAction(async () => {
    const actor = await requirePlatformAdminAction();
    if (!(await rateLimit(`domain-attach:${actor.id}`, ATTACHES_PER_HOUR, 60 * 60 * 1000)).ok) {
      throw new ActionError("That is a lot of domains at once. Try again in a little while.");
    }
    const clinic = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { id: true } });
    if (!clinic) throw new ActionError("That clinic no longer exists.");

    const checked = checkClinicDomain(String(fd.get("host") ?? ""));
    if (!checked.ok) {
      logDomain("refused", { reason: checked.reason });
      throw new ActionError(refusalMessage(checked.reason));
    }
    const host = checked.host;

    // Platform-wide, not per clinic: two clinics cannot share a host, and the
    // middleware's host map assumes exactly that.
    const taken = await rawDb.clinicDomain.findUnique({ where: { host }, select: { tenantId: true } });
    if (taken) {
      logDomain("refused", { reason: "already_used" });
      throw new ActionError(
        taken.tenantId === clinic.id ? "That domain is already attached to this clinic." : "That domain is already attached to another clinic.",
      );
    }
    const existing = await rawDb.clinicDomain.findUnique({ where: clientDomainOf(clinic.id), select: { host: true } });
    if (existing) throw new ActionError(`This clinic already uses ${existing.host}. Remove that first.`);

    let vercel;
    try {
      vercel = await api().add(host);
    } catch (err) {
      logDomain("vercel_refused");
      throw new ActionError(describeError(err));
    }

    const row = await rawDb.clinicDomain.create({
      data: {
        tenantId: clinic.id,
        type: "CLIENT",
        host,
        status: vercel.verified ? "VERIFIED" : "PENDING",
        verification: asJson(vercel.verification),
        lastCheckedAt: new Date(),
        verifiedAt: vercel.verified ? new Date() : null,
        createdByUserId: actor.id,
      },
    });
    // Only a verified domain is routed, so only a verified one changes the map.
    if (row.status === "VERIFIED") forgetClinicHosts();

    await writeAuditLog({
      tenantId: clinic.id,
      actorUserId: actor.id,
      actorType: "PLATFORM_ADMIN",
      action: "clinic.domain_attached",
      entityType: "ClinicDomain",
      entityId: row.id,
      metadata: { host, status: row.status },
    });
    logDomain("attached", { status: row.status });

    revalidatePath(`/agency/clinics/${merchantId}`);
    return { domain: view(row) };
  });
}

/** Asks Vercel to look at DNS again now, and writes down what it said. */
export async function checkClinicDomainAction(merchantId: string): Promise<ActionResult<{ domain: DomainView }>> {
  return runAction(async () => {
    const actor = await requirePlatformAdminAction();
    if (!(await rateLimit(`domain-check:${actor.id}`, CHECKS_PER_HOUR, 60 * 60 * 1000)).ok) {
      throw new ActionError("That is a lot of checks at once. Try again in a little while.");
    }
    const row = await rawDb.clinicDomain.findUnique({ where: clientDomainOf(merchantId) });
    if (!row) throw new ActionError("This clinic has no domain to check.");

    const wasVerified = row.status === "VERIFIED";
    let status: "PENDING" | "VERIFIED" | "FAILED" = row.status;
    let verification: VercelVerificationChallenge[] = asChallenges(row.verification);
    let lastError: string | null = null;

    try {
      const vercel = await api().verify(row.host);
      status = vercel.verified ? "VERIFIED" : "PENDING";
      verification = vercel.verification;
    } catch (err) {
      // A failed check is news, not a reason to throw the row away: the admin
      // needs to see why, and the next check may well succeed.
      status = "FAILED";
      lastError = describeError(err);
      logDomain("check_failed");
    }

    const updated = await rawDb.clinicDomain.update({
      where: { id: row.id },
      data: {
        status,
        verification: asJson(verification),
        lastError,
        lastCheckedAt: new Date(),
        verifiedAt: status === "VERIFIED" ? (row.verifiedAt ?? new Date()) : null,
      },
    });

    // Either direction changes what should be routed.
    if (wasVerified !== (status === "VERIFIED")) {
      forgetClinicHosts();
      if (status === "VERIFIED") {
        await writeAuditLog({
          tenantId: merchantId,
          actorUserId: actor.id,
          actorType: "PLATFORM_ADMIN",
          action: "clinic.domain_verified",
          entityType: "ClinicDomain",
          entityId: row.id,
          metadata: { host: row.host },
        });
      }
    }
    logDomain("checked", { status });

    revalidatePath(`/agency/clinics/${merchantId}`);
    return { domain: view(updated) };
  });
}

export async function removeClinicDomainAction(merchantId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requirePlatformAdminAction();
    const row = await rawDb.clinicDomain.findUnique({ where: clientDomainOf(merchantId) });
    if (!row) throw new ActionError("This clinic has no domain to remove.");

    // Vercel first: a row deleted while the domain stayed on the project
    // leaves a host nobody can account for, and attaching it again would
    // then fail on a conflict with an owner the console cannot show.
    try {
      await api().remove(row.host);
    } catch (err) {
      logDomain("vercel_remove_failed");
      throw new ActionError(describeError(err));
    }
    await rawDb.clinicDomain.delete({ where: { id: row.id } });
    forgetClinicHosts();

    await writeAuditLog({
      tenantId: merchantId,
      actorUserId: actor.id,
      actorType: "PLATFORM_ADMIN",
      action: "clinic.domain_removed",
      entityType: "ClinicDomain",
      entityId: row.id,
      metadata: { host: row.host },
    });
    logDomain("removed");

    revalidatePath(`/agency/clinics/${merchantId}`);
    return {};
  });
}
