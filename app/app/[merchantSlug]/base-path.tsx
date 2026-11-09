"use client";

import * as React from "react";

/**
 * Where this clinic's app lives on the host the client is actually on:
 * "/riverside" on the shared client host, "/app/riverside" elsewhere, and ""
 * on the clinic's own domain, where the app is the whole site.
 *
 * Never ends in a slash — that is the contract that lets every link in the
 * app be written `${base}/shop` and come out with one slash on all three.
 * Use `useHomePath()` where the base is the whole href, since "" is not one.
 *
 * It matters beyond tidiness: the installed home-screen app's scope is this
 * path, and a link outside it drops the client out of full screen into
 * Safari, address bar and all. The value comes from the server, where the
 * host is known, so it is identical in the first render and after hydration.
 */
const BasePath = React.createContext<string | null>(null);

export function BasePathProvider({ base, children }: { base: string; children: React.ReactNode }) {
  return <BasePath.Provider value={base}>{children}</BasePath.Provider>;
}

export function useBasePath(): string {
  const base = React.useContext(BasePath);
  if (base === null) throw new Error("useBasePath is only available inside a clinic's app.");
  return base;
}

/**
 * The clinic's time zone, for every date and time the app prints.
 *
 * It comes from the server with the rest of the clinic, so the first render
 * and the hydrated one agree — which the phone's own time zone could not
 * promise. See lib/client-format.ts for why that matters.
 */
const TimeZone = React.createContext<string>("");

export function ClinicTimeZoneProvider({ timeZone, children }: { timeZone: string; children: React.ReactNode }) {
  return <TimeZone.Provider value={timeZone}>{children}</TimeZone.Provider>;
}

export function useClinicTimeZone(): string {
  return React.useContext(TimeZone);
}

/**
 * The clinic's app home, as an href. Same as the base path everywhere except
 * a clinic's own domain, where the base is "" and the home is "/".
 */
export function useHomePath(): string {
  return useBasePath() || "/";
}

/**
 * "Find your clinic" — the one screen that is deliberately outside a clinic's
 * scope, because it belongs to no clinic. On the shared client host it is the
 * host itself; elsewhere it is /app.
 *
 * Null on a clinic's own domain, where there is no finder: that host is one
 * clinic and nothing else, and sending a client from it to a list of other
 * clinics would walk them off the app they installed.
 */
export function useFinderPath(): string | null {
  const base = useBasePath();
  if (base === "") return null;
  return base.startsWith("/app/") ? "/app" : "/";
}
