import { nanoid } from "nanoid";
import type { ChannelProvider, NotificationSendResult } from "./types";
import { isRealProduction } from "@/lib/deploy-env";

/**
 * Logs to the console and "succeeds" — used for every channel until real
 * credentials are configured. On a developer's machine that is the point: a
 * reset link can be followed straight from the terminal.
 *
 * Email in real production is the exception. There the mock used to report
 * every email as sent while nothing left the building, and the only sign was
 * a console line nobody read — which is how a missing EMAIL_PROVIDER went
 * unnoticed. It now refuses, the same way the mock payment provider does
 * (docs/security/review-2026-11.md, P-2): one loud error, and a FAILED result
 * the caller logs as such (lib/emails/send-log.ts).
 */
export class MockChannelProvider implements ChannelProvider {
  constructor(private readonly channelName: string) {}

  async send(params: { to: string; subject?: string; body: string; html?: string; from?: string }): Promise<NotificationSendResult> {
    if (this.channelName === "email" && isRealProduction()) {
      console.error('[email] EMAIL_PROVIDER is not "resend" in production: email NOT sent. Set EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM, then redeploy.');
      return { providerMessageId: "", status: "FAILED", code: "not_configured", error: "Email isn't configured on this deployment." };
    }
    // Bodies hold one-time links and recipients are personal data. Print them
    // only where logs stay on this machine; a production build (staging, a
    // local `npm run serve`) keeps its logs, so it gets neither.
    const local = process.env.NODE_ENV !== "production";
    const to = local ? ` -> ${params.to}` : "";
    const body = local ? params.body : "(body withheld)";
    console.log(`[mock:${this.channelName}]${to}: ${params.subject ?? ""} ${body}`);
    return { providerMessageId: `mock_${this.channelName}_${nanoid(10)}`, status: "SENT" };
  }
}
