import { nanoid } from "nanoid";
import type { ChannelProvider, NotificationSendResult } from "./types";

/** Logs to the console and always "succeeds" — used for every channel until real credentials are configured. */
export class MockChannelProvider implements ChannelProvider {
  constructor(private readonly channelName: string) {}

  async send(params: { to: string; subject?: string; body: string }): Promise<NotificationSendResult> {
    console.log(`[mock:${this.channelName}] -> ${params.to}: ${params.subject ?? ""} ${params.body.slice(0, 80)}`);
    return { providerMessageId: `mock_${this.channelName}_${nanoid(10)}`, status: "SENT" };
  }
}
