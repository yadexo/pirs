import type { ChannelProvider, NotificationSendResult } from "./types";

/**
 * Documented integration point for Twilio (or another SMS gateway). Set
 * SMS_PROVIDER=twilio and TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/
 * TWILIO_FROM_NUMBER in .env, install the `twilio` SDK, and implement send()
 * below. Not wired to a live account in this environment.
 */
export class TwilioSmsProvider implements ChannelProvider {
  async send(): Promise<NotificationSendResult> {
    throw new Error(
      "Real SMS delivery is not configured. Implement lib/providers/notifications/sms.ts#TwilioSmsProvider, or set SMS_PROVIDER=mock.",
    );
  }
}
