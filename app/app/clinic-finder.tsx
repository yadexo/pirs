"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, Sheet } from "@/components/client-app/ui";
import { findClinicsAction } from "@/lib/actions/clinic-directory";
import type { ListedClinic } from "@/lib/clinic-directory";
import { slugFromScannedCode } from "@/lib/clinic-link";
import { useQrCamera, type CameraProblem } from "@/components/use-qr-camera";

export function ClinicFinder({ appName }: { appName: string }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<ListedClinic[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [opening, setOpening] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      findClinicsAction(q)
        .then((r) => {
          if (!live) return;
          if ("error" in r) setError(r.error);
          else {
            setError(null);
            setResults(r.results);
          }
        })
        .catch(() => live && setError("Couldn't search right now. Check your connection."));
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);

  const open = React.useCallback(
    (slug: string, join: boolean) => {
      setOpening(slug);
      router.push(`/app/${slug}${join ? "?join=1" : ""}`);
    },
    [router],
  );

  return (
    <div style={{ minHeight: "100dvh", maxWidth: 480, margin: "0 auto", padding: "calc(var(--sat) + 40px) var(--pad-x) 40px" }}>
      <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: 0 }}>{appName}</p>
      <h1 style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.15, color: "var(--ink-strong)", margin: "8px 0" }}>Find your clinic</h1>
      <p style={{ fontSize: 16, color: "var(--muted)", margin: "0 0 28px" }}>Scan the QR code at your clinic, or search for it by name.</p>

      <button type="button" className="btn-black" style={{ width: "100%" }} onClick={() => setScanning(true)}>
        <Icon name="scan" size={22} /> Scan clinic QR code
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0", color: "var(--faint)", fontSize: 13 }}>
        <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
        or
        <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-surface)", borderRadius: 999, height: 54, padding: "0 20px", boxShadow: "var(--shadow-card)" }}>
        <Icon name="search" size={20} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Clinic name or city"
          aria-label="Search clinics"
          autoComplete="off"
          enterKeyHint="search"
          style={{ flex: 1, border: 0, background: "transparent", fontSize: 16, outline: "none", color: "var(--ink)" }}
        />
      </label>

      <div style={{ marginTop: 16 }} aria-live="polite">
        {error ? (
          <p style={{ color: "var(--danger)", fontSize: 15 }}>{error}</p>
        ) : results === null ? null : results.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 15, padding: "8px 4px" }}>
            No clinic found. Not every clinic is listed — ask yours for their QR code or link.
          </p>
        ) : (
          <div style={{ background: "var(--bg-surface)", borderRadius: "var(--r-card)", boxShadow: "var(--shadow-card)", padding: "6px 16px" }}>
            {results.map((c) => (
              <button key={c.slug} type="button" className="optrow" onClick={() => open(c.slug, false)} disabled={opening !== null}>
                {c.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.logoUrl} alt="" style={{ width: 40, height: 40, borderRadius: 12, objectFit: "contain", background: "var(--bg-app)" }} />
                ) : (
                  <span style={{ width: 40, height: 40, borderRadius: 12, background: "var(--black)", color: "var(--on-black)", display: "grid", placeItems: "center", fontWeight: 700 }}>
                    {c.name.charAt(0)}
                  </span>
                )}
                <span style={{ flex: 1, textAlign: "left" }}>
                  <b style={{ fontSize: 15, display: "block" }}>{c.name}</b>
                  {c.city && <span style={{ fontSize: 13, color: "var(--muted)" }}>{c.city}</span>}
                </span>
                <Icon name="chevR" size={18} />
              </button>
            ))}
          </div>
        )}
      </div>

      <Sheet open={scanning} onClose={() => setScanning(false)} title="Scan clinic QR code">
        {scanning && <ClinicScanner onSlug={(slug) => open(slug, true)} />}
      </Sheet>
    </div>
  );
}

const PROBLEMS: Record<CameraProblem, string> = {
  unsupported: "This browser can't use the camera. Search for your clinic by name instead.",
  denied: "Camera access is blocked. Allow it in your browser settings, or search by name.",
  missing: "No camera found. Search for your clinic by name instead.",
};

function ClinicScanner({ onSlug }: { onSlug: (slug: string) => void }) {
  const [wrongCode, setWrongCode] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  const onCode = React.useCallback(
    (value: string) => {
      const slug = slugFromScannedCode(value);
      if (slug) onSlug(slug);
      else setWrongCode(true);
    },
    [onSlug],
  );

  if (wrongCode) {
    return (
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <p style={{ color: "var(--ink)", fontSize: 16, margin: "0 0 16px" }}>That isn&apos;t a clinic code. Look for the QR code your clinic shows at the desk.</p>
        <button
          type="button"
          className="btn-black"
          style={{ margin: "0 auto", padding: "0 28px" }}
          onClick={() => {
            setWrongCode(false);
            setAttempt((n) => n + 1);
          }}
        >
          Scan again
        </button>
      </div>
    );
  }
  return <Viewfinder key={attempt} onCode={onCode} />;
}

function Viewfinder({ onCode }: { onCode: (value: string) => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const { problem, starting } = useQrCamera(videoRef, onCode);
  if (problem) return <p style={{ color: "var(--muted)", fontSize: 15, textAlign: "center", padding: "24px 0" }}>{PROBLEMS[problem]}</p>;
  return (
    <div style={{ position: "relative", aspectRatio: "1", width: "100%", borderRadius: "var(--r-card)", overflow: "hidden", background: "var(--black)", marginBottom: 12 }}>
      <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <div aria-hidden="true" style={{ position: "absolute", inset: "18%", borderRadius: 18, border: "2px solid var(--on-black-muted)" }} />
      {starting && <p style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--on-black-muted)", margin: 0 }}>Starting camera…</p>}
    </div>
  );
}
