/**
 * Every write in a server action says whose row it is writing.
 *
 * docs/security/review-2026-11-pass2.md, I-3 and I-4: an ownership check
 * (`findFirst({ where: { id, customerProfileId } })`) followed by a write
 * keyed only by what the caller sent (`updateMany({ where: { id } })`). The
 * check passed on one row; the write matched many. The argument checks now
 * stop objects reaching either query — this test makes sure the write would
 * be safe even if one got through: its where clause carries an owner, or the
 * id of a row already loaded under one.
 *
 * Accepted in a where clause:
 * - `tenantId`, `customerProfileId`, `user.id` / `userId: user.…` — an owner;
 * - `<row>.id` or `<row>.<x>Id` — a value read from a row loaded earlier,
 *   never from the caller's own input (`input.`, `params.` and `args.` do not
 *   count).
 * Anything else needs an entry in EXEMPT saying why it is safe.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ACTIONS_DIR = join(process.cwd(), "lib", "actions");

/** "file:model.op:where" → why it is safe. Short, and every entry is a decision. */
const EXEMPT: Record<string, string> = {
  "merchants.ts:tenant.update:{ id: merchantId }": "Platform admin only; a clinic is the platform's own row.",
  "platform-admins.ts:user.update:{ id: userId }": "Platform admin only; platform admins are global rows with no clinic.",
  "app-builder.ts:catalogItemTag.deleteMany:link": "`link` is { serviceId } or { productId } of an item just loaded through the clinic's scoped client.",
  "app-builder.ts:clientResult.deleteMany:link": "Same `link` as above.",
};

const OWNER = [/\btenantId\b/, /\bcustomerProfileId\b/, /\buser\.id\b/, /\buserId:\s*user\./];
const FROM_ROW = /\b(?!input\b|params\b|args\b)[a-z]\w*(?:\[\d+\]!?)?!?\.(?:id|\w+Id)\b/;

interface Write {
  key: string;
  at: string;
  where: string;
}

function writes(): Write[] {
  const found: Write[] = [];
  for (const file of readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(ACTIONS_DIR, file), "utf8").replace(/\r/g, "");
    // `<client>.<model>.<op>(`, also split across lines — a cookie jar's `.delete(` is not a database write.
    for (const m of text.matchAll(/\b\w+\s*\.(\w+)\s*\.(update|updateMany|delete|deleteMany|upsert)\(/g)) {
      const model = m[1]!;
      let depth = 1;
      let at = m.index! + m[0].length;
      while (depth > 0 && at < text.length) {
        const ch = text[at++];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      const call = text.slice(m.index! + m[0].length, at - 1);
      let where = whereOf(call);
      const named = where === "(shorthand)" ? "where" : /^[a-z]\w*$/.test(where) ? where : null;
      if (named) {
        // `{ where, data }` or `{ where: mine }`: the nearest `const <name> = {...};` before the call.
        const decl = [...text.slice(0, m.index).matchAll(new RegExp(`const ${named} = (\\{[^;]*\\});`, "g"))].pop();
        if (decl) where = decl[1]!.replace(/\s+/g, " ");
        else if (where === "(shorthand)") where = "(none)";
      }
      found.push({ key: `${file}:${model}.${m[2]}:${where}`, at: `${file}:${text.slice(0, m.index).split("\n").length}`, where });
    }
  }
  return found;
}

/** The text of the `where:` value, balanced, with whitespace collapsed. */
function whereOf(call: string): string {
  if (!/\bwhere\s*:/.test(call) && /\bwhere\s*[,}]/.test(call)) return "(shorthand)";
  const start = /\bwhere\s*:\s*/.exec(call);
  if (!start) return "(none)";
  let at = start.index + start[0].length;
  if (call[at] !== "{") return /^\w+/.exec(call.slice(at))?.[0] ?? "(none)";
  let depth = 0;
  const from = at;
  do {
    const ch = call[at++];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  } while (depth > 0 && at < call.length);
  return call.slice(from, at).replace(/\s+/g, " ").trim();
}

describe("every write in a server action names its owner", () => {
  const all = writes();

  it("finds the writes at all", () => {
    expect(all.length).toBeGreaterThan(60);
    expect(all.some((w) => w.key.startsWith("client-membership.ts:customerMembership.updateMany"))).toBe(true);
    expect(all.some((w) => w.key.includes("jar."))).toBe(false);
  });

  it("each where clause carries an owner or a loaded row's id", () => {
    const unscoped = all
      .filter((w) => !(w.key in EXEMPT))
      .filter((w) => !OWNER.some((re) => re.test(w.where)) && !FROM_ROW.test(w.where))
      .map((w) => `${w.at}  ${w.key}`);
    expect(unscoped).toEqual([]);
  });

  it("has no stale exemptions", () => {
    const keys = new Set(all.map((w) => w.key));
    for (const key of Object.keys(EXEMPT)) expect(keys.has(key), `${key} is exempt but no longer exists`).toBe(true);
  });

  it("a where clause from the caller's own input does not count as a loaded row", () => {
    expect(FROM_ROW.test("{ id: input.appointmentId }")).toBe(false);
    expect(FROM_ROW.test("{ id: existing.id }")).toBe(true);
    expect(FROM_ROW.test("{ id: others[0]!.id }")).toBe(true);
  });
});
