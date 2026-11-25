/**
 * What a visitor sees when there is nothing to show (QA report, fix round 1
 * item 8).
 *
 * - A suspended clinic's app said nothing but Next's bare "404 | This page
 *   could not be found", in English, as if the clinic had never existed. It
 *   now shows the clinic's own name and logo and says the app is temporarily
 *   unavailable, without saying why. The same on the clinic's own domain,
 *   which therefore keeps resolving while the clinic is suspended.
 * - A page that does not exist shows a not-found page in the visitor's
 *   language: branded on a clinic's own domain, where the host already says
 *   whose it is, and neutral everywhere else, so it gives away nothing about
 *   which clinics exist.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rawDb } from "@/lib/db";
import { deleteTenantCompletely } from "@/lib/tenant-deletion";
import { readClinicHostMap } from "@/lib/clinic-hosts";
import nl from "@/messages/nl.json";
import en from "@/messages/en.json";

vi.mock("server-only", () => ({}));

const { getSuspendedClinic, getClinicBrand } = await import("@/lib/clinic-brand");
const { UnavailableView } = await import("@/components/client-app/unavailable-view");
const { NotFoundView } = await import("@/components/not-found-view");

const SUSPENSION_WORDS = /suspend|geschorst|opgeschort|geblokkeerd|blocked|betaling|payment/i;

describe("a suspended clinic", () => {
  const stamp = Date.now();
  const ids: string[] = [];
  const make = async (status: "ACTIVE" | "SUSPENDED" | "PENDING") => {
    const id = (await rawDb.tenant.create({ data: { slug: `una-${status.toLowerCase()}-${stamp}`, name: `Una ${status}`, status } })).id;
    await rawDb.tenantBranding.create({ data: { tenantId: id, businessName: `Una ${status} Clinic`, logoUrl: `/logo-${status}.png` } });
    await rawDb.clinicDomain.create({ data: { tenantId: id, host: `app.una-${status.toLowerCase()}-${stamp}.test`, status: "VERIFIED", type: "CLIENT" } });
    ids.push(id);
    return `una-${status.toLowerCase()}-${stamp}`;
  };
  let active: string;
  let suspended: string;
  let pending: string;

  beforeAll(async () => {
    active = await make("ACTIVE");
    suspended = await make("SUSPENDED");
    pending = await make("PENDING");
  });
  afterAll(async () => {
    for (const id of ids) await deleteTenantCompletely(id);
  });

  it("is recognised, with its own name and logo", async () => {
    expect(await getSuspendedClinic(suspended)).toEqual({ name: "Una SUSPENDED Clinic", logoUrl: "/logo-SUSPENDED.png", color: "#0f766e" }); // the schema's default brand colour
    expect(await getSuspendedClinic(active)).toBeNull();
    expect(await getSuspendedClinic(pending)).toBeNull();
    expect(await getSuspendedClinic(`nobody-${stamp}`)).toBeNull();
  });

  it("keeps its own domain, so that domain can say so", async () => {
    const { hosts } = await readClinicHostMap();
    expect(hosts[`app.una-suspended-${stamp}.test`]).toBe(suspended);
    expect(hosts[`app.una-active-${stamp}.test`]).toBe(active);
    expect(hosts[`app.una-pending-${stamp}.test`]).toBeUndefined();
  });

  it("the not-found page's branding is there for an active or suspended clinic only", async () => {
    expect((await getClinicBrand(active))?.name).toBe("Una ACTIVE Clinic");
    expect((await getClinicBrand(suspended))?.name).toBe("Una SUSPENDED Clinic");
    expect(await getClinicBrand(pending)).toBeNull();
    expect(await getClinicBrand(`nobody-${stamp}`)).toBeNull();
  });

  it("the client app checks for it before anything else", () => {
    const layout = readFileSync("app/app/[merchantSlug]/layout.tsx", "utf8");
    const check = layout.indexOf("getSuspendedClinic(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(layout.indexOf("getClientAppContext(merchantSlug)"));
    expect(layout).toMatch(/<UnavailableView/);
  });
});

describe("the temporarily-unavailable page", () => {
  it("shows the clinic and says it is temporarily unavailable, not why", () => {
    const html = renderToStaticMarkup(
      createElement(UnavailableView, { name: "Riverside", logoUrl: "/logo.png", title: "Tijdelijk niet beschikbaar", body: "Probeer het later opnieuw." }),
    );
    expect(html).toContain("Riverside");
    expect(html).toContain('src="/logo.png"');
    expect(html).toContain("Tijdelijk niet beschikbaar");
    for (const messages of [nl, en]) {
      const u = messages.clientApp.unavailable;
      expect(u.title).toBeTruthy();
      expect(u.body).toContain("{name}");
      expect(`${u.title} ${u.body}`).not.toMatch(SUSPENSION_WORDS);
    }
  });
});

describe("the not-found page", () => {
  const text = { title: "Pagina niet gevonden", body: "Deze pagina bestaat niet.", home: "Naar de startpagina" };

  it("is neutral off a clinic's domain: no clinic, no platform name", () => {
    const html = renderToStaticMarkup(createElement(NotFoundView, { ...text, clinic: null }));
    expect(html).toContain("Pagina niet gevonden");
    expect(html).not.toMatch(/<img/);
    expect(html).not.toMatch(/deza|dermis/i);
  });

  it("is branded on a clinic's own domain", () => {
    const html = renderToStaticMarkup(createElement(NotFoundView, { ...text, clinic: { name: "Riverside", logoUrl: "/logo.png", color: null } }));
    expect(html).toContain("Riverside");
    expect(html).toContain('src="/logo.png"');
    expect(html).toContain('href="/"');
  });

  it("exists in both languages, and brands only from the clinic-host header", () => {
    for (const messages of [nl, en]) {
      expect(messages.notFound.title).toBeTruthy();
      expect(messages.notFound.body).toBeTruthy();
      expect(messages.notFound.home).toBeTruthy();
    }
    expect(nl.notFound.title).not.toBe(en.notFound.title);
    expect(existsSync("app/not-found.tsx")).toBe(true);
    const page = readFileSync("app/not-found.tsx", "utf8");
    expect(page).toMatch(/currentClinicHostSlug\(\)/);
    expect(page).toMatch(/getClinicBrand\(/);
  });
});
