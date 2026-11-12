/**
 * What the action files export, and what they must not.
 *
 * Every function exported from a "use server" file is a public endpoint:
 * Next gives it an id and anyone who learns the id can call it, whether or
 * not it was written as an action. Two plain helpers were exported that way —
 * one read any client's credit balance by profile id, with no session check
 * (docs/security/review-2026-11.md, T-3).
 *
 * The rule this enforces is a naming one, because naming is what a reader
 * sees: an action file exports functions called `somethingAction`, and
 * nothing else. A helper that is not an action lives in another file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ACTIONS_DIR = join(process.cwd(), "lib", "actions");

/** Deliberate exceptions, each with its reason. Empty, and meant to stay that way. */
const NOT_AN_ACTION_ON_PURPOSE: Record<string, string> = {};

interface ActionFile {
  name: string;
  source: string;
}

function actionFiles(): ActionFile[] {
  return readdirSync(ACTIONS_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, source: readFileSync(join(ACTIONS_DIR, name), "utf8").replace(/\r/g, "") }));
}

/** Runtime exports: functions and consts. Types and interfaces are erased and are not endpoints. */
function runtimeExports(source: string): string[] {
  return [...source.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map((match) => match[1]!);
}

describe("action files", () => {
  const files = actionFiles();

  it("are found, and are all server modules", () => {
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) expect(file.source.startsWith('"use server";'), `${file.name} is in lib/actions but is not a "use server" file`).toBe(true);
  });

  it("export only functions named as actions", () => {
    const strays = files.flatMap((file) =>
      runtimeExports(file.source)
        .filter((name) => !name.endsWith("Action") && !(`${file.name}:${name}` in NOT_AN_ACTION_ON_PURPOSE))
        .map((name) => `${file.name}: ${name}`),
    );
    // If this fails for something you just wrote: a helper exported from a
    // "use server" file is a public endpoint. Move it to a file under lib/.
    expect(strays).toEqual([]);
  });

  it("have no stale exceptions", () => {
    for (const key of Object.keys(NOT_AN_ACTION_ON_PURPOSE)) {
      const [file, name] = key.split(":");
      const found = files.find((f) => f.name === file);
      expect(found && runtimeExports(found.source).includes(name!), `${key} is excepted but does not exist`).toBe(true);
    }
  });

  it("no longer include the old /admin actions, or the unused analytics module", () => {
    // Deleted in the same change (T-4). Nothing reached them, and one adjusted
    // credit with a read-then-write the live code replaced with an atomic
    // update — not something to be found and reused.
    for (const gone of ["customers.ts", "loyalty.ts", "locations.ts", "settings.ts"]) expect(existsSync(join(ACTIONS_DIR, gone)), gone).toBe(false);
    expect(existsSync(join(process.cwd(), "lib", "analytics.ts"))).toBe(false);
  });
});
