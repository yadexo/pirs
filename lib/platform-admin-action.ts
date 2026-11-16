import "server-only";
import { requireRole, ForbiddenError, TwoFactorRequiredError, TWO_FACTOR_FIRST, UnauthorizedError } from "@/lib/rbac";
import { ActionError } from "@/lib/action-error";
import { getImpersonatedMerchantId } from "@/lib/impersonation-policy";

/**
 * The guard every platform-level action shares: the right role, two-factor
 * already confirmed, and not in the middle of impersonating a clinic.
 *
 * The UI never reaches these actions without all three already being true —
 * requireAgencyContext() redirects an unconfirmed admin away from the whole
 * console — but each action checks for itself regardless, because a button
 * being hidden is not the same as the server refusing.
 *
 * Impersonation is in here because while it is on, an admin is acting *as* a
 * clinic. Platform-wide changes made in that state would be logged against
 * the wrong actor and, worse, would be easy to make by accident.
 */
export async function requirePlatformAdminAction() {
  // requireRole's declared return type is narrower than what it actually
  // returns (requireSession spreads the live account in) — the same widening
  // every other caller of user.twoFactorConfirmed (lib/merchant-context.ts)
  // relies on.
  let user: Awaited<ReturnType<typeof requireRole>> & { twoFactorConfirmed: boolean };
  try {
    user = (await requireRole("PLATFORM_ADMIN")) as typeof user;
  } catch (err) {
    // ActionError is what runAction's catch-all shows the caller verbatim;
    // ForbiddenError/UnauthorizedError would otherwise be logged as an
    // unexpected failure and hidden behind a generic message, which a normal
    // permission refusal never should be.
    // requireRole refuses an admin who has not set up two-factor (lib/rbac.ts);
    // that one keeps its own message, because it tells them what to do.
    if (err instanceof TwoFactorRequiredError) throw new ActionError(TWO_FACTOR_FIRST);
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) throw new ActionError("Not permitted.");
    throw err;
  }
  if (await getImpersonatedMerchantId()) throw new ActionError("Not available while impersonating.");
  if (!user.twoFactorConfirmed) throw new ActionError(TWO_FACTOR_FIRST);
  return user;
}

/**
 * The same guard for actions not wrapped in runAction: the refusal comes back
 * as `{ error }` for the caller to return, instead of escaping as an
 * unhandled server error the admin only sees as "something went wrong"
 * (docs/security/review-2026-11-pass2.md, A-13 and the note under A-1).
 */
export async function platformAdminOrRefusal(): Promise<{ user: Awaited<ReturnType<typeof requirePlatformAdminAction>> } | { error: string }> {
  try {
    return { user: await requirePlatformAdminAction() };
  } catch (err) {
    if (err instanceof ActionError) return { error: err.message };
    throw err;
  }
}
