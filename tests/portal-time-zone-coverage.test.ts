/**
 * Every date and time the clinic portal shows is in the clinic's time zone.
 *
 * A date formatted without a zone is shown in whatever zone renders it: the
 * server's (UTC in production) for a server page, the staff member's laptop
 * for a client component. Either way a clinic in Amsterdam could see an
 * appointment at the wrong hour, or on the wrong day near midnight. And a
 * local-clock call such as getHours() or setHours() builds days and hours in
 * that same accidental zone.
 *
 * So in the portal's code every toLocaleString / toLocaleDateString /
 * toLocaleTimeString call names a timeZone, and the local-clock methods are
 * not used at all — days and wall-clock times go through lib/clinic-time.ts.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app/m", "components/merchant"];
const LOCAL_CLOCK = /\.(getHours|getMinutes|getDay|getDate|getMonth|getFullYear|setHours|setMinutes|setDate|setMonth|setFullYear)\(/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const sources = ROOTS.flatMap((root) => files(join(process.cwd(), root))).map((path) => ({
  file: relative(process.cwd(), path).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8").replace(/\r/g, ""),
}));

describe("the clinic portal shows dates in the clinic's time zone", () => {
  it("reads the portal's files", () => {
    expect(sources.length).toBeGreaterThan(40);
  });

  it("every toLocale…String call names a timeZone", () => {
    const missing: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/\.toLocale(?:Date|Time)?String\(/g)) {
        let depth = 1;
        let at = m.index! + m[0].length;
        while (depth > 0 && at < text.length) {
          const ch = text[at++];
          if (ch === "(") depth++;
          else if (ch === ")") depth--;
        }
        if (!/\btimeZone\b/.test(text.slice(m.index!, at))) missing.push(`${file}:${text.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("no local-clock date methods", () => {
    const local = sources.flatMap(({ file, text }) =>
      text
        .split("\n")
        .map((line, i) => (LOCAL_CLOCK.test(line) ? `${file}:${i + 1}: ${line.trim()}` : null))
        .filter((x): x is string => x !== null),
    );
    expect(local).toEqual([]);
  });
});
