export type NotificationSendResult = {
  providerMessageId: string;
  status: "SENT" | "FAILED";
  error?: string;
};

export interface ChannelProvider {
  /** `html` is optional; channels that cannot render it send `body`. */
  send(params: { to: string; subject?: string; body: string; html?: string }): Promise<NotificationSendResult>;
}
