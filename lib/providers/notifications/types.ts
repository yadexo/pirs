export type NotificationSendResult = {
  providerMessageId: string;
  status: "SENT" | "FAILED";
  error?: string;
  /**
   * Why it failed, as a plain code for logs: `not_configured`, `http_<status>`,
   * `timeout` or `network`. `error` keeps the provider's own words.
   */
  code?: string;
};

export interface ChannelProvider {
  /**
   * `html` is optional; channels that cannot render it send `body`. `from`
   * overrides the provider's default sender — used to put the clinic's own
   * name on an email while still sending through our verified address.
   */
  send(params: { to: string; subject?: string; body: string; html?: string; from?: string }): Promise<NotificationSendResult>;
}
