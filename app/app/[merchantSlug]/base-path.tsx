"use client";

import * as React from "react";

/**
 * Where this clinic's app lives on the host the client is actually on:
 * "/riverside" on the root domain, "/app/riverside" anywhere else.
 *
 * Every link inside the app is built from this. It matters beyond tidiness:
 * the installed home-screen app's scope is this path, and a link outside it
 * drops the client out of full screen into Safari, address bar and all. The
 * value comes from the server, where the host is known, so it is identical in
 * the first render and after hydration.
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
 * "Find your clinic" — the one screen that is deliberately outside a clinic's
 * scope, because it belongs to no clinic. On the root domain it is the domain
 * itself; elsewhere it is /app.
 */
export function useFinderPath(): string {
  return useBasePath().startsWith("/app/") ? "/app" : "/";
}
