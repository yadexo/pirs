import "server-only";
import { rawDb } from "@/lib/db";

/**
 * Whether a clinic uses the app's own booking (Tenant.inAppBookings).
 *
 * Off by default: clinics book through their own software, and a platform
 * admin switches it on per clinic. Every booking action checks this for
 * itself — a hidden button does not stop a direct call to a server action.
 */
export const BOOKINGS_OFF = "Booking in the app isn't available at this clinic.";

export async function inAppBookingsOn(tenantId: string): Promise<boolean> {
  const clinic = await rawDb.tenant.findUnique({ where: { id: tenantId }, select: { inAppBookings: true } });
  return clinic?.inAppBookings === true;
}
