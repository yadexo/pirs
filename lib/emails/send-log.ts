import type { NotificationSendResult } from "@/lib/providers/notifications/types";

/**
 * One log line per transactional email, saying whether it went:
 *
 *   [email] kind=password_reset outcome=sent
 *   [email] kind=password_reset outcome=failed reason=http_403 detail=The mail.deza.ai domain is not verified.
 *
 * Search for `[email]`. Before this, a reset, welcome or invite whose send
 * failed — or that went to the mock provider because EMAIL_PROVIDER was not
 * set — left nothing behind, and the person was told "sent" either way.
 *
 * Never the recipient: who we emailed is personal data, and logs travel
 * further than the database. The provider's own message is kept because it
 * is what says what is wrong ("domain is not verified"), but anything in it
 * shaped like an address is replaced first.
 */
export type EmailKind =
  | "password_reset"
  | "account_exists"
  | "welcome_client"
  | "welcome_clinic_owner"
  | "platform_admin_invite"
  | "staff_invite"
  | "client_notice"
  | "account_closed";

/** The same plain-label rule as lib/signin-log.ts. */
const SAFE = /^[A-Za-z0-9_+-]{1,64}$/;
const clean = (value: string) => (SAFE.test(value) ? value : "?");

/** The provider's message, without addresses or line breaks, and not too long. */
function scrub(message: string): string {
  return message
    .replace(/[^\s<>"'`,;:()]+@[^\s<>"'`,;:()]+/g, "<address>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function logEmailSend(kind: EmailKind, result: NotificationSendResult): void {
  try {
    if (result.status === "SENT") {
      console.info(`[email] kind=${clean(kind)} outcome=sent`);
      return;
    }
    const detail = result.error ? scrub(result.error) : "";
    console.error(`[email] kind=${clean(kind)} outcome=failed reason=${clean(result.code ?? "unknown")}${detail ? ` detail=${detail}` : ""}`);
  } catch {
    /* logging must never be the reason something fails */
  }
}
