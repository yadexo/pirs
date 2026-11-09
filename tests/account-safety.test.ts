import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/**
 * Two rules about accounts that are easy to state and easy to break by
 * accident, so they are checked against the source rather than trusted.
 *
 * A heuristic over text, like tests/i18n-key-coverage.test.ts: it can be
 * fooled by something written unusually, but it catches the shape a
 * well-meaning change actually takes.
 */

const SCAN_DIRS = ["lib", "app", "components", "prisma"];
const SKIP = new Set(["node_modules", ".next", "migrations"]);

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

const files = SCAN_DIRS.flatMap(walk).map((path) => ({ path, text: readFileSync(path, "utf8") }));
/** Comments explain the rules; only code is under test. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * The flat `data: { … }` objects in some code — what a query *writes*, as
 * opposed to the `where: { … }` it matches on. Flat is enough: every account
 * write in this codebase sets its columns at the top level.
 */
const writtenObjects = (text: string) => [...text.matchAll(/\bdata:\s*(\{[^{}]*\})/g)].map((m) => m[1] ?? "");

describe("nobody is ever handed a password", () => {
  // An account is reached by a one-time link and its holder chooses their own
  // password. Generating one and showing or mailing it puts a working
  // credential somewhere it can be read later — an inbox, a screenshot, a
  // support thread. lib/actions/staff.ts did exactly this until it was deleted.
  it("no code generates a password for someone else", () => {
    const offenders = files.filter((f) => /\b(tempPassword|temporaryPassword|generateTempPassword|generatedPassword)\b/.test(code(f.text)));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("the only passwordHash an account is created with is the one that matches nothing", () => {
    // Every create path writes the "!invited" sentinel; a real hash at
    // creation time would mean a password existed before its owner chose it.
    for (const f of files) {
      for (const [, value] of code(f.text).matchAll(/passwordHash:\s*("(?:[^"]*)")/g)) {
        expect(value, `${f.path} creates an account with ${value}`).toBe('"!invited"');
      }
    }
  });
});

describe("a platform admin cannot be demoted from inside the app", () => {
  // Deactivating the last active one is refused (lib/actions/platform-admins.ts,
  // covered by platform-admin-deactivate.test.ts). The other way to lose every
  // admin is quieter: change the role on the row instead of the status. No
  // action does that today, and nothing should start.
  it("no server action writes a role onto an account that already exists", () => {
    const offenders: string[] = [];
    for (const f of files.filter((f) => f.path.includes(join("lib", "actions")))) {
      const text = code(f.text);
      for (const match of text.matchAll(/\.user\.(update|updateMany|upsert)\(/g)) {
        // Only what is being written, not what is being matched on: a `where`
        // naming a role is how these calls stay safe, not how they go wrong.
        const call = text.slice(match.index, (match.index ?? 0) + 600);
        for (const written of writtenObjects(call)) {
          if (/\brole:/.test(written)) offenders.push(`${f.path}: data ${written.slice(0, 70)}…`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only the two create paths make a PLATFORM_ADMIN at all", () => {
    const allowed = [join("lib", "platform-admin-create.ts"), join("prisma", "create-platform-admin.ts"), join("prisma", "seed.ts")];
    // A `data: { … role: "PLATFORM_ADMIN" … }`, which is a row being written.
    // A `where` clause naming the role, or a comparison against it, is
    // ordinary and everywhere.
    const offenders = files
      .filter((f) => writtenObjects(code(f.text)).some((written) => /role:\s*["'`]PLATFORM_ADMIN["'`]/.test(written)))
      .map((f) => f.path)
      .filter((path) => !allowed.some((a) => path.endsWith(a)));
    expect(offenders).toEqual([]);
  });
});
