"use client";

import * as React from "react";
import { DEFAULT_TIME_ZONE } from "@/lib/time-zone";

/**
 * The clinic's time zone, for every date and time the client app and the
 * clinic portal print.
 *
 * It comes from the server with the rest of the clinic, so the first render
 * and the hydrated one agree — which the device's own time zone could not
 * promise — and a staff member on a laptop set to another zone still sees
 * the clinic's times. See lib/client-format.ts and lib/clinic-time.ts.
 */
const TimeZone = React.createContext<string>(DEFAULT_TIME_ZONE);

export function ClinicTimeZoneProvider({ timeZone, children }: { timeZone: string; children: React.ReactNode }) {
  return <TimeZone.Provider value={timeZone}>{children}</TimeZone.Provider>;
}

export function useClinicTimeZone(): string {
  return React.useContext(TimeZone);
}
