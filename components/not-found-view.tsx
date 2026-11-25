import Link from "next/link";
import type { ClinicBrand } from "@/lib/clinic-brand";

/**
 * "Page not found", in the visitor's language. On a clinic's own domain it
 * carries that clinic's logo and leads back to its app; anywhere else it is
 * neutral — no clinic and no platform name — so a guessed address learns
 * nothing about which clinics exist.
 * (tests/integration/unavailable-and-not-found.test.ts)
 */
export function NotFoundView({ title, body, home, clinic }: { title: string; body: string; home: string; clinic: ClinicBrand | null }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "0 24px",
        textAlign: "center",
        background: "#ffffff",
        color: "#111111",
      }}
    >
      {clinic?.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={clinic.logoUrl} alt={clinic.name} style={{ height: 56, width: "auto", objectFit: "contain" }} />
      )}
      {clinic && !clinic.logoUrl && <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{clinic.name}</p>}
      <h1 style={{ fontSize: 27, fontWeight: 700, lineHeight: 1.2, margin: 0 }}>{title}</h1>
      <p style={{ fontSize: 16, color: "#666666", maxWidth: "32ch", margin: 0 }}>{body}</p>
      {clinic && (
        <Link
          href="/"
          style={{ marginTop: 8, padding: "14px 28px", borderRadius: 999, background: clinic.color ?? "#111111", color: "#ffffff", fontSize: 16, fontWeight: 600, textDecoration: "none" }}
        >
          {home}
        </Link>
      )}
    </main>
  );
}
