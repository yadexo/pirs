/** Public base URL of this deployment, without a trailing slash. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/*
 * There used to be three more builders here — clientAppOrigin, clientAppUrl
 * and clinicJoinUrl — each deciding between the short and the long client
 * address by reading CLIENT_APP_URL for itself. They are gone, along with
 * lib/client-app-url.ts, because a clinic's own domain gave them a third
 * answer to disagree about: a QR code printed with one address and an email
 * sent with another is how a client ends up with two installs of the same
 * app and two sets of notifications.
 *
 * Everything that links a client into a clinic's app now goes through
 * lib/clinic-app-link.ts, which knows about all three.
 */
