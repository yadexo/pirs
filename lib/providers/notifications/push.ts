import type { ChannelProvider, NotificationSendResult } from "./types";

/**
 * Documented integration point for Web Push. Set PUSH_PROVIDER=webpush and
 * WEB_PUSH_PUBLIC_KEY/WEB_PUSH_PRIVATE_KEY in .env, install the `web-push`
 * SDK, store subscriptions per customer, and implement send() below. Not
 * wired to live keys in this environment.
 */
export class WebPushProvider implements ChannelProvider {
  async send(): Promise<NotificationSendResult> {
    throw new Error(
      "Real push delivery is not configured. Implement lib/providers/notifications/push.ts#WebPushProvider, or set PUSH_PROVIDER=mock.",
    );
  }
}
