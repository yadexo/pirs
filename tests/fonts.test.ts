import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/**
 * The build must not depend on fetching a font from anybody else.
 *
 * next/font/google downloads at build time, so a bad response from
 * fonts.googleapis.com fails the build outright — which is what happened on
 * Vercel ("Cannot read properties of null (reading '1')") while the same
 * commit built fine locally. The fix was to commit the files; this keeps them
 * committed.
 */

const SCAN_DIRS = ["app", "lib", "components"];
const SKIP = new Set(["node_modules", ".next", "fonts"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if ([".ts", ".tsx"].includes(extname(entry))) out.push(full);
  }
  return out;
}

describe("fonts are ours, not fetched at build time", () => {
  it("nothing imports next/font/google", () => {
    // Comments are allowed to name it — explaining why it is gone is worth
    // more than the extra word in a grep. Only code is under test, as in
    // tests/account-safety.test.ts.
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const offenders = SCAN_DIRS.flatMap(walk).filter((path) => /next\/font\/google/.test(code(readFileSync(path, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("every font file the layout names is actually committed", () => {
    const layout = readFileSync(join("app", "layout.tsx"), "utf8");
    const named = [...layout.matchAll(/["'`][^"'`]*?([\w-]+\.woff2?)["'`]/g)].map((m) => m[1]!);
    // If this is empty the regex has drifted, and the check below would pass
    // by testing nothing at all.
    expect(named.length).toBeGreaterThan(0);
    for (const file of named) {
      const path = join("app", "fonts", file);
      expect(existsSync(path), `${path} is referenced but not committed`).toBe(true);
      // A git-lfs pointer or a failed download is a small text file, not a font.
      expect(statSync(path).size).toBeGreaterThan(1000);
      expect(readFileSync(path).subarray(0, 4).toString("latin1"), `${path} is not a woff2`).toBe("wOF2");
    }
  });

  it("ships the licence the font is under, as the licence requires", () => {
    const licence = readFileSync(join("app", "fonts", "OFL.txt"), "utf8");
    expect(licence).toContain("SIL OPEN FONT LICENSE");
    expect(licence).toContain("Hanken Grotesk");
  });

  it("falls back per character through every subset before reaching the system font", () => {
    // next/font/local has no unicode-range, so coverage depends entirely on
    // all four families being in the stack, in order, ahead of the system font.
    const tokens = readFileSync(join("app", "design-tokens.css"), "utf8");
    const stack = /--font-ui:([^;]+);/.exec(tokens)?.[1] ?? "";
    for (const variable of ["--font-hanken", "--font-hanken-latin-ext", "--font-hanken-vietnamese", "--font-hanken-cyrillic-ext"]) {
      expect(stack, `${variable} is not in the --font-ui stack`).toContain(`var(${variable})`);
    }
    expect(stack.indexOf("var(--font-hanken)")).toBeLessThan(stack.indexOf("system-ui"));
  });
});
