/**
 * Client-facing wording for a clinic with in-app bookings off.
 *
 * Clinics book through their own software unless the platform switches the
 * app's own booking on (Tenant.inAppBookings). Without it, texts that promise
 * appointment updates or invite booking in the app would be untrue, so each
 * has a twin that says the same without them. Links to the clinic's own
 * booking page are a different thing and keep their wording.
 *
 * Message key → the key used instead when bookings are off. Both live in
 * messages/en.json and messages/nl.json; tests check the replacements say
 * nothing about booking or appointments.
 */
export const BOOKING_COPY = {
  "clientApp.profile.noTreatmentPurchasedSub": "clientApp.profile.noTreatmentPurchasedSubNoBookings",
  "clientApp.notifications.sheetBody": "clientApp.notifications.sheetBodyNoBookings",
  "clientApp.notifications.settingsOn": "clientApp.notifications.settingsOnNoBookings",
  "clientApp.installNudge.why": "clientApp.installNudge.whyNoBookings",
} as const;

type FullKey = keyof typeof BOOKING_COPY;

/** The key inside its namespace to use, e.g. bookingKey("clientApp.installNudge.why", false) → "whyNoBookings". */
export function bookingKey<K extends FullKey>(key: K, inAppBookings: boolean): string {
  const full = inAppBookings ? key : BOOKING_COPY[key];
  return full.slice(full.lastIndexOf(".") + 1);
}

/** The app's description for browsers and home screens. */
export function clientAppDescription(clinicName: string, inAppBookings: boolean): string {
  return inAppBookings ? `${clinicName} — bookings, rewards and membership.` : `${clinicName} — rewards and membership.`;
}
