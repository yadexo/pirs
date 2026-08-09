import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one glossy-black surface used by the Home hero, the Shop banner, the
 * Scan QR card, and the Rewards loyalty card. Every one of those reads
 * through this component — do not hand-roll gradients elsewhere.
 */
export function GlossSurface({
  radius = "var(--radius-card)",
  particles = false,
  tilt = false,
  className,
  children,
}: {
  radius?: string;
  /** Sparse white dots — Shop banner only. */
  particles?: boolean;
  /** Perspective tilt + thickened edge — Rewards loyalty card only. */
  tilt?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{
        borderRadius: radius,
        background: "linear-gradient(135deg, #2a2d33 0%, #0b0d12 100%)",
        ...(tilt
          ? {
              transform: "perspective(900px) rotateX(4deg) rotateY(-6deg)",
              boxShadow: "0 22px 34px -10px rgba(0,0,0,0.45), 0 2px 0 rgba(255,255,255,0.04) inset",
            }
          : undefined),
      }}
    >
      {/* Primary specular sweep */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-1/4 -top-1/3 h-[160%] w-[70%] rotate-[18deg] blur-3xl"
        style={{ background: "rgba(255,255,255,0.12)" }}
      />
      {/* Secondary, fainter sweep for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-1/3 top-1/4 h-[140%] w-[45%] rotate-[14deg] blur-3xl"
        style={{ background: "rgba(255,255,255,0.05)" }}
      />
      {/* Grain overlay */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.05] mix-blend-overlay">
        <filter id="gloss-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#gloss-grain)" />
      </svg>

      {particles && <Particles />}

      <div className="relative">{children}</div>
    </div>
  );
}

/** Sparse 1–2px dots at low opacity, seeded so they don't shift on re-render. */
function Particles() {
  const dots = React.useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        // Deterministic pseudo-random spread from the index — avoids a
        // hydration mismatch from Math.random() on the server vs client.
        const seed = (i * 9301 + 49297) % 233280;
        const rand = seed / 233280;
        return {
          left: `${(i * 37 + rand * 20) % 100}%`,
          top: `${(i * 53 + rand * 30) % 100}%`,
          size: 1 + (i % 2),
          opacity: 0.2 + (rand % 0.2),
        };
      }),
    [],
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {dots.map((d, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{ left: d.left, top: d.top, width: d.size, height: d.size, opacity: d.opacity }}
        />
      ))}
    </div>
  );
}
