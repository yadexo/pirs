"use client";

import * as React from "react";

/**
 * Whether this clinic uses the app's own booking (Tenant.inAppBookings), for
 * the components that show or word booking. Off by default; the server
 * refuses booking for itself whatever this says (lib/in-app-bookings.ts).
 */
const InAppBookings = React.createContext(false);

export function InAppBookingsProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <InAppBookings.Provider value={on}>{children}</InAppBookings.Provider>;
}

export function useInAppBookings(): boolean {
  return React.useContext(InAppBookings);
}
