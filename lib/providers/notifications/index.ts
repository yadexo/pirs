import type { ChannelProvider } from "./types";
import { MockChannelProvider } from "./mock";
import { ResendEmailProvider } from "./email";
import { TwilioSmsProvider } from "./sms";
import { WebPushProvider } from "./push";

export function getEmailProvider(): ChannelProvider {
  return process.env.EMAIL_PROVIDER === "resend" ? new ResendEmailProvider() : new MockChannelProvider("email");
}

export function getSmsProvider(): ChannelProvider {
  return process.env.SMS_PROVIDER === "twilio" ? new TwilioSmsProvider() : new MockChannelProvider("sms");
}

export function getPushProvider(): ChannelProvider {
  return process.env.PUSH_PROVIDER === "webpush" ? new WebPushProvider() : new MockChannelProvider("push");
}

export function getChannelProvider(channel: "EMAIL" | "SMS" | "PUSH" | "IN_APP"): ChannelProvider | null {
  switch (channel) {
    case "EMAIL":
      return getEmailProvider();
    case "SMS":
      return getSmsProvider();
    case "PUSH":
      return getPushProvider();
    default:
      return null; // IN_APP is written directly to the Notification table, no provider needed
  }
}

export * from "./types";
