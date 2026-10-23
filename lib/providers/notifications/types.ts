export type NotificationSendResult = {
  providerMessageId: string;
  status: "SENT" | "FAILED";
  error?: string;
};

export interface ChannelProvider {
  /**
   * `html` is optional; channels that cannot render it send `body`. `from`
   * overrides the provider's default sender — used to put the clinic's own
   * name on an email while still sending through our verified address.
   */
  send(params: { to: string; subject?: string; body: string; html?: string; from?: string }): Promise<NotificationSendResult>;
}
