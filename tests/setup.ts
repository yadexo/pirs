import { config } from "dotenv";
import { vi } from "vitest";

config({ path: ".env.test" });

// Server actions call these Next.js runtime helpers, which throw outside of
// an actual request context. Stub them so action code under test can run in
// plain Node — a thrown "redirect" signals a successful action, which tests
// catch and assert around; revalidatePath is a no-op we don't need to verify.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Server actions and the text-check guard resolve a locale via
// lib/locale.ts, which reads the current request's headers — there is no
// request here, so stub an empty one. Combined with no signed-in session,
// resolveLocale() falls through to its platform default ("nl").
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {} })),
}));

// next-intl/server resolves to its "Client Components" build outside a real
// Next.js build (no react-server condition in plain Node/vitest) — the same
// class of issue as next-auth's package root earlier in this project. Tests
// don't exercise translation correctness (messages/*.json's own structure
// isn't tested here); they exercise behavior, so this reads real strings
// from messages/en.json with minimal interpolation, enough for the handful
// of server actions that build user-facing text via getTranslations.
vi.mock("next-intl/server", async () => {
  const en = (await import("../messages/en.json")).default as Record<string, unknown>;
  function resolve(namespace: string) {
    const parts = namespace.split(".");
    let node: unknown = en;
    for (const part of parts) node = (node as Record<string, unknown>)?.[part];
    return node as Record<string, unknown>;
  }
  function interpolate(template: string, values?: Record<string, unknown>): string {
    if (!values) return template;
    return template.replace(/\{(\w+)(?:,\s*plural,\s*([^}]*\{[^}]*\}[^}]*))?\}/g, (_, key: string, plural?: string) => {
      const value = values[key];
      if (plural !== undefined && typeof value === "number") {
        const oneMatch = /one\s*\{([^}]*)\}/.exec(plural);
        const otherMatch = /other\s*\{([^}]*)\}/.exec(plural);
        const chosen = value === 1 ? oneMatch?.[1] : otherMatch?.[1];
        return (chosen ?? "").replace(/#/g, String(value));
      }
      return String(value ?? "");
    });
  }
  function makeT(namespace: string) {
    const scope = resolve(namespace) ?? {};
    const t = (key: string, values?: Record<string, unknown>) => {
      const parts = key.split(".");
      let node: unknown = scope;
      for (const part of parts) node = (node as Record<string, unknown>)?.[part];
      return typeof node === "string" ? interpolate(node, values) : key;
    };
    t.rich = (key: string) => t(key);
    return t;
  }
  return {
    getTranslations: vi.fn(async (namespace: string) => makeT(namespace)),
    getLocale: vi.fn(async () => "en"),
  };
});
