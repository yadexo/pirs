"use client";

import * as React from "react";
import { BlackButton, ClientEmptyState } from "@/components/client-app/primitives";

export interface ClientLocation {
  id: string;
  name: string;
  address: string;
  phone: string | null;
}

export function LocationBlock({ locations, merchantName }: { locations: ClientLocation[]; merchantName: string }) {
  const [index, setIndex] = React.useState(0);

  if (locations.length === 0) {
    return (
      <div className="mt-6 px-[var(--space-screen-x)]">
        <ClientEmptyState text="No clinic location added yet" />
      </div>
    );
  }

  const current = locations[index]!;

  return (
    <section className="mt-6">
      {/* Static map placeholder — no map provider key is configured, so this
          renders a neutral surface with the pin rather than an empty iframe. */}
      <div className="relative h-[260px] w-full bg-[var(--pill-bg)]">
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[var(--black)]">
            <span className="h-2.5 w-2.5 rounded-full bg-white" />
          </span>
        </div>
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[13px] text-[var(--muted)]">
          Map preview unavailable
        </span>
      </div>

      <div className="px-[var(--space-screen-x)] pt-5">
        <h2 className="text-[28px] font-bold leading-tight text-[var(--ink-strong)]">{merchantName}</h2>
        <p className="mt-2 flex items-start gap-2 text-[16px] text-[var(--muted)]">
          <PinIcon />
          <span>{current.address || "Address not set"}</span>
        </p>

        {locations.length > 1 && (
          <div className="mt-3 flex gap-1.5">
            {locations.map((l, i) => (
              <button
                key={l.id}
                type="button"
                aria-label={`Show ${l.name}`}
                onClick={() => setIndex(i)}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-[var(--black)]" : "w-1.5 bg-[var(--faint)]"}`}
              />
            ))}
          </div>
        )}

        {current.phone && (
          <a href={`tel:${current.phone}`} className="press mt-4 block">
            <BlackButton className="w-full">Call now</BlackButton>
          </a>
        )}
      </div>
    </section>
  );
}

function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" className="mt-0.5 shrink-0">
      <path d="M9 16s5.5-4.6 5.5-9A5.5 5.5 0 0 0 3.5 7c0 4.4 5.5 9 5.5 9Z" />
      <circle cx="9" cy="7" r="2" />
    </svg>
  );
}
