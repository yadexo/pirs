import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import en from "@/messages/en.json";
import nl from "@/messages/nl.json";

/**
 * tests/i18n.test.ts proves en.json and nl.json agree with each other. It
 * can't catch a key that's missing from *both* — a t()/tc() call for
 * something nobody ever added — which is exactly what let common.search
 * (app/app/[merchantSlug]/search-sheet.tsx) ship with no translation at all
 * in either language: next-intl degrades to showing the literal key as the
 * accessible name instead of throwing, so nothing failed loudly until
 * someone looked at the accessibility tree.
 *
 * A heuristic, not a parser (same disclaimer as the prose check in
 * tests/i18n.test.ts): this finds `const t = useTranslations("ns")` /
 * `await getTranslations("ns")` bindings and the t("key")/t.rich("key")
 * calls that use them, then checks each resolved "ns.key" path exists in
 * both message files. A dynamic key built from a template literal or a
 * variable can't be resolved statically and is skipped rather than guessed
 * at — those need their own targeted test if they matter.
 *
 * Scoping is position-based (nearest preceding same-named binding), which
 * is wrong for a translator passed as a function *parameter* rather than
 * closed over directly — app-builder/settings/sections.tsx's stripeNotices(t)
 * and stripeStatusMap(t) helpers are exactly this shape. Rather than chase
 * real lexical scope with a regex, a call is accepted if its key resolves
 * under *any* namespace bound in the same file, not only the nearest one —
 * still catches a key that's missing everywhere nearby, which is the actual
 * failure mode this test exists for.
 */

const SCAN_DIRS = ["app", "lib", "components"];
const SKIP_DIR_NAMES = new Set(["node_modules", ".next"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), obj);
}

const BINDING_RE = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*["'`]([A-Za-z0-9_.]+)["'`]\s*\)/g;

interface KeyUse {
  file: string;
  /** The nearest-binding guess, only for labeling a failure — resolution checks every candidate. */
  fullKey: string;
  candidates: string[];
}

function findKeyUses(file: string, source: string): KeyUse[] {
  const uses: KeyUse[] = [];

  // Position, not just name: a file with several components each doing their
  // own `const t = useTranslations(...)` rebinds the same variable name to a
  // different namespace per component. A call is scoped to the *nearest
  // preceding* binding of that name, not "whichever binding happened last in
  // the whole file" — components are declared sequentially, so this matches
  // real scoping closely enough without a real parser.
  const bindings: { index: number; varName: string; namespace: string }[] = [];
  for (const m of source.matchAll(BINDING_RE)) bindings.push({ index: m.index ?? 0, varName: m[1]!, namespace: m[2]! });
  if (bindings.length === 0) return uses;

  const fileNamespaces = [...new Set(bindings.map((b) => b.namespace))];
  const varNames = [...new Set(bindings.map((b) => b.varName))];
  for (const varName of varNames) {
    const ownBindings = bindings.filter((b) => b.varName === varName).sort((a, b) => a.index - b.index);
    // `varName("key")` or `varName.rich("key")` — not `varName.raw(...)`, which
    // returns raw JSON rather than a message and isn't held to the same shape.
    const callRe = new RegExp(`\\b${varName}(?:\\.rich)?\\(\\s*["'\`]([A-Za-z0-9_.]+)["'\`]`, "g");
    for (const m of source.matchAll(callRe)) {
      const start = m.index ?? 0;
      // A preceding `.` or identifier char means this matched inside a longer
      // identifier or a `foo.varName(...)` access, not a call to the bound
      // translator itself.
      const prevChar = start > 0 ? source[start - 1] : "";
      if (prevChar && /[.\w$]/.test(prevChar)) continue;
      const nearest = [...ownBindings].reverse().find((b) => b.index < start);
      if (!nearest) continue;
      uses.push({ file, fullKey: `${nearest.namespace}.${m[1]}`, candidates: fileNamespaces.map((ns) => `${ns}.${m[1]}`) });
    }
  }
  return uses;
}

describe("every t()/tc() key used in code exists in both message files", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(d));
  const allUses: KeyUse[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("Translations(")) continue;
    allUses.push(...findKeyUses(file, source));
  }

  it("found a non-trivial number of translation call sites (sanity check on the scan itself)", () => {
    expect(allUses.length).toBeGreaterThan(200);
  });

  it("every referenced key resolves in messages/en.json", () => {
    const missing = allUses.filter((u) => !u.candidates.some((c) => typeof get(en, c) === "string")).map((u) => `${u.fullKey} (${u.file})`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("every referenced key resolves in messages/nl.json", () => {
    const missing = allUses.filter((u) => !u.candidates.some((c) => typeof get(nl, c) === "string")).map((u) => `${u.fullKey} (${u.file})`);
    expect([...new Set(missing)]).toEqual([]);
  });
});
