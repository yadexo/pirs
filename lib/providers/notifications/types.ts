export type NotificationSendResult = {
  providerMessageId: string;
  status: "SENT" | "FAILED";
  error?: string;
};

export interface ChannelProvider {
  send(params: { to: string; subject?: string; body: string }): Promise<NotificationSendResult>;
}
