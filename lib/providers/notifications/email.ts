import type { ChannelProvider, NotificationSendResult } from "./types";

/**
 * Documented integration point for a real transactional email provider
 * (Resend, Postmark, SES, ...). Set EMAIL_PROVIDER=resend and RESEND_API_KEY
 * in .env, then install the provider's SDK and implement send() below. Not
 * wired to a live account in this environment.
 */
export class ResendEmailProvider implements ChannelProvider {
  async send(): Promise<NotificationSendResult> {
    throw new Error(
      "Real email delivery is not configured. Implement lib/providers/notifications/email.ts#ResendEmailProvider, or set EMAIL_PROVIDER=mock.",
    );
  }
}
