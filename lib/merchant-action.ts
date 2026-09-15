import "server-only";
import { z } from "zod";
import { auth } from "@/auth";
import { rawDb } from "@/lib/db";
import { getTenantDb, type TenantDb } from "@/lib/tenant-db";
import { writeAuditLog } from "@/lib/audit";
import { loadLiveAccount } from "@/lib/live-account";
import type { PermissionKey } from "@/lib/permissions";
import type { SessionUserShape } from "@/types/next-auth";

/**
 * What an action needs to be allowed:
 * - a PermissionKey: clinic owners always, staff whose role grants it;
 * - "owner": clinic owners only (branding, team, integrations — things that
 *   change the business, not the day's work).
 * - "member": anyone who works at the clinic, for steps that change nothing on
 *   their own (uploading an image a later, permission-checked save will use).
 * Agency admins pass all of them: managing any clinic is their job.
 */
export type MerchantRequirement = PermissionKey | "owner" | "member";

export interface MerchantActionContext {
  user: SessionUserShape;
  merchantId: string;
  db: TenantDb;
  /** Records who did what. Agency admins are logged as such. */
  audit: (action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>) => Promise<void>;
}

/** Thrown for anything the caller should see as a plain message. */
export class ActionError extends Error {}

const NOT_ALLOWED = "You don't have access to do that.";

/**
 * Authorises a write against the clinic named in the request.
 *
 * Unlike requireStaffContext — which takes the clinic from the session and so
 * rejects agency admins outright — this takes the clinic explicitly, which is
 * what lets an agency admin edit a clinic they are viewing.
 *
 * A clinic user naming a clinic that is not theirs gets the same message as a
 * missing permission, so the response never reveals that another clinic exists.
 */
export async function requireMerchantAction(merchantId: string, need: MerchantRequirement): Promise<MerchantActionContext> {
  const sessionUser = (await auth())?.user;
  if (!sessionUser) throw new ActionError("Please sign in again.");
  // Role, clinic and permissions come from the database, not the 30-day token:
  // a deactivated account or a removed permission stops working immediately.
  const live = await loadLiveAccount(sessionUser.id, sessionUser.authTime);
  if (!live) throw new ActionError("Please sign in again.");
  const user: SessionUserShape = { ...sessionUser, ...live };

  const tenant = await rawDb.tenant.findUnique({ where: { id: merchantId }, select: { id: true, status: true } });
  if (!tenant) throw new ActionError(NOT_ALLOWED);

  const isAgency = user.role === "PLATFORM_ADMIN";
  if (!isAgency) {
    if (user.tenantId !== merchantId || tenant.status !== "ACTIVE") throw new ActionError(NOT_ALLOWED);
    if (user.role === "STAFF") {
      if (need === "owner") throw new ActionError(NOT_ALLOWED);
      if (need === "member") return context();
      const granted = user.permissions === "ALL" || user.permissions.includes(need);
      if (!granted) throw new ActionError(NOT_ALLOWED);
    } else if (user.role !== "TENANT_ADMIN") {
      throw new ActionError(NOT_ALLOWED);
    }
  }

  return context();

  function context(): MerchantActionContext {
    return {
    user,
    merchantId,
    db: getTenantDb(merchantId),
    audit: (action, entityType, entityId, metadata) =>
      writeAuditLog({
        tenantId: merchantId,
        actorUserId: user.id,
        actorType: isAgency ? "PLATFORM_ADMIN" : "STAFF",
        action,
        entityType,
        entityId,
        metadata,
      }),
    };
  }
}

/**
 * Schemas name money fields for what is stored (`priceCents`); forms name them
 * for what is typed (`price`). Errors are reported under the form's name so
 * the right input gets highlighted.
 */
const FIELD_ALIASES: Record<string, string> = {
  priceCents: "price",
  includedCreditCents: "includedCredit",
  discountAmountCents: "discountAmount",
};

export type ActionResult<T = object> = ({ ok: true } & T) | { error: string; fieldErrors?: Record<string, string> };

/**
 * Runs an action body and turns expected failures into a result the form can
 * show. Validation errors become per-field messages. Anything unexpected is
 * logged and reported generically — never leaking internals to the browser.
 */
export async function runAction<T extends object>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await body()) };
  } catch (err) {
    if (err instanceof ActionError) return { error: err.message };
    if (err instanceof z.ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) {
        const path = issue.path.join(".") || "_";
        const key = FIELD_ALIASES[path] ?? path;
        fieldErrors[key] ??= issue.message;
      }
      return { error: "Please fix the highlighted fields.", fieldErrors };
    }
    // Next.js control flow (redirect/notFound) must propagate.
    if (err instanceof Error && /^NEXT_(REDIRECT|NOT_FOUND)/.test(err.message)) throw err;
    if (typeof err === "object" && err && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    console.error("[action] unexpected failure", err);
    return { error: "Something went wrong. Please try again." };
  }
}

/** Form helpers: empty inputs become undefined so optional fields validate. */
export const formText = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
export const formBool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";

/** "49.50" → 4950. Accepts a comma decimal separator too ("49,50"). */
export const moneyToCents = z
  .string({ required_error: "Enter a price" })
  .transform((v) => v.replace(",", ".").trim())
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter an amount like 49 or 49.50")
  .transform((v) => Math.round(Number(v) * 100));
