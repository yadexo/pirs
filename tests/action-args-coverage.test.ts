/**
 * Every client-side server action checks every argument it is given.
 *
 * A server action is a public endpoint; its TypeScript signature is not a
 * check on what a browser sends (lib/action-args.ts). This test is what makes
 * "every action validates its arguments" a fact rather than an intention: it
 * reads the action files and fails for any exported action with a parameter
 * that is not named in a `validArgs(...)` call.
 *
 * It was written after a quantity of minus one made an order free and an
 * unchecked object let a client write to any column of their own profile
 * (docs/security/review-2026-11.md, P-1 and R-2) — both in files where every
 * argument had a perfectly good type.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The files whose exported actions a signed-in client — or anyone — can call. */
const CLIENT_ACTION_FILES = ["client-app.ts", "client-catalog.ts", "client-scan.ts", "clinic-directory.ts"];

/**
 * Parameters that are deliberately not in a validArgs call, by
 * "file:function:parameter", each with the reason. Empty, and meant to stay
 * that way.
 */
const EXEMPT: Record<string, string> = {};

interface Action {
  file: string;
  name: string;
  params: string[];
  body: string;
}

/** The exported async functions of one file, with their parameter names and bodies. */
function actionsIn(file: string): Action[] {
  const source = readFileSync(join(process.cwd(), "lib", "actions", file), "utf8").replace(/\r/g, "");
  const starts = [...source.matchAll(/^export async function (\w+)\(/gm)];
  return starts.map((match, index) => {
    const open = match.index! + match[0].length;
    // Walk to the parenthesis that closes the parameter list.
    let depth = 1;
    let at = open;
    while (depth > 0 && at < source.length) {
      const ch = source[at++];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    const list = source.slice(open, at - 1);
    const end = index + 1 < starts.length ? starts[index + 1]!.index! : source.length;
    return { file, name: match[1]!, params: paramNames(list), body: source.slice(at, end) };
  });
}

/** Top-level parameter names of a parameter list, ignoring everything inside their types. */
function paramNames(list: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list + ",") {
    if ("({[<".includes(ch)) depth++;
    else if (")}]>".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      const name = /^\s*(\w+)/.exec(current)?.[1];
      if (name) names.push(name);
      current = "";
    } else current += ch;
  }
  return names;
}

/** The names inside the array of the action's first `validArgs(schema, [a, b])` call. */
function validatedNames(body: string): string[] | null {
  const call = /validArgs\([\s\S]*?,\s*\[([^\]]*)\]\s*\)\)/.exec(body);
  if (!call) return null;
  return call[1]!
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

describe("client-side actions validate what they are sent", () => {
  const all = CLIENT_ACTION_FILES.flatMap(actionsIn);

  it("finds the actions at all (a reader that finds nothing would pass everything)", () => {
    expect(all.length).toBeGreaterThan(20);
    const add = all.find((a) => a.name === "clientAddToCartAction");
    expect(add?.params).toEqual(["slug", "kind", "id", "qty"]);
    // A parameter whose type contains commas and braces is still one parameter.
    expect(all.find((a) => a.name === "clientCheckoutAction")?.params).toEqual(["slug", "rewardId", "options"]);
  });

  it("every parameter of every action is named in its validArgs call, in order", () => {
    const problems: string[] = [];
    for (const action of all) {
      const needed = action.params.filter((param) => !(`${action.file}:${action.name}:${param}` in EXEMPT));
      if (needed.length === 0) continue;
      const checked = validatedNames(action.body);
      if (!checked) {
        problems.push(`${action.file}: ${action.name} takes (${action.params.join(", ")}) and never calls validArgs`);
        continue;
      }
      if (checked.join(",") !== needed.join(",")) {
        problems.push(`${action.file}: ${action.name} takes (${needed.join(", ")}) but validates [${checked.join(", ")}]`);
      }
    }
    // If this fails for an action you just wrote: check its arguments with
    // validArgs(args([...]), [every, parameter]) as its first statement.
    expect(problems).toEqual([]);
  });

  it("the check comes before anything is read from the database", () => {
    const late = all
      .filter((action) => action.params.length > 0)
      .filter((action) => {
        const check = action.body.indexOf("validArgs(");
        const firstQuery = action.body.search(/\b(db|rawDb|tx)\.\w+\.\w+\(/);
        return check >= 0 && firstQuery >= 0 && firstQuery < check;
      })
      .map((action) => `${action.file}: ${action.name}`);
    expect(late).toEqual([]);
  });

  it("has no stale exemptions", () => {
    for (const key of Object.keys(EXEMPT)) {
      const [file, name, param] = key.split(":");
      const action = all.find((a) => a.file === file && a.name === name);
      expect(action?.params.includes(param!), `${key} is exempted but does not exist`).toBe(true);
    }
  });
});
