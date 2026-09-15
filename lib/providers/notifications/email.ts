import type { ChannelProvider, NotificationSendResult } from "./types";

/**
 * Transactional email through Resend's HTTP API — one request, no SDK.
 *
 *   EMAIL_PROVIDER=resend
 *   RESEND_API_KEY=re_...
 *   EMAIL_FROM="Clinic Name <no-reply@your-verified-domain.com>"
 *
 * The From domain must be verified in Resend, or delivery is refused.
 */
export class ResendEmailProvider implements ChannelProvider {
  async send(params: { to: string; subject?: string; body: string; html?: string }): Promise<NotificationSendResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      return { providerMessageId: "", status: "FAILED", error: "RESEND_API_KEY and EMAIL_FROM must both be set." };
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [params.to], subject: params.subject ?? "", text: params.body, html: params.html }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !json.id) {
        return { providerMessageId: "", status: "FAILED", error: json.message ?? `Resend responded ${res.status}` };
      }
      return { providerMessageId: json.id, status: "SENT" };
    } catch (err) {
      return { providerMessageId: "", status: "FAILED", error: err instanceof Error ? err.message : "Network error" };
    }
  }
}
