/**
 * Every server action in the app checks every argument it is given, strictly.
 *
 * A server action is a public endpoint; its TypeScript signature is not a
 * check on what a browser sends (lib/action-args.ts). This test is what makes
 * "every action validates its arguments" a fact rather than an intention.
 *
 * History. The first version (R-2, after a quantity of minus one made an
 * order free) read four client-side files and accepted any schema at all,
 * including `z.record(z.unknown())`. An object sent where an appointment id
 * belonged then rewrote every appointment of a clinic, and one sent where a
 * membership id belonged cancelled every membership
 * (docs/security/review-2026-11-pass2.md, I-3 and I-4). So it now reads every
 * action file, and refuses the schemas that let an object through.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ACTIONS_DIR = join(process.cwd(), "lib", "actions");

/**
 * Parameters that are deliberately not in a validArgs call, by
 * "file:function:parameter", each with the reason. Empty, and meant to stay
 * that way.
 */
const EXEMPT: Record<string, string> = {};

/**
 * Schema pieces that accept an object of any shape, or anything at all.
 * `arg.prevState` (lib/action-args.ts) is the one sanctioned "anything": it
 * is the ignored first argument React's useActionState passes, and it is
 * never read.
 */
const LOOSE = [/z\.record\(/, /z\.any\(/, /z\.unknown\(/, /z\.custom\b/, /\.passthrough\(/, /\.catchall\(/];

interface Action {
  file: string;
  name: string;
  params: string[];
  body: string;
}

function actionFiles(): string[] {
  return readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts"));
}

function source(file: string): string {
  return readFileSync(join(ACTIONS_DIR, file), "utf8").replace(/\r/g, "");
}

/** The exported async functions of one file, with their parameter names and bodies. */
function actionsIn(file: string): Action[] {
  const text = source(file);
  const starts = [...text.matchAll(/^export async function (\w+)\(/gm)];
  return starts.map((match, index) => {
    const open = match.index! + match[0].length;
    let depth = 1;
    let at = open;
    while (depth > 0 && at < text.length) {
      const ch = text[at++];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    const list = text.slice(open, at - 1);
    const end = index + 1 < starts.length ? starts[index + 1]!.index! : text.length;
    return { file, name: match[1]!, params: paramNames(list), body: text.slice(at, end) };
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

/** Every `z.object(` in a file, with whether `.strict()` follows its closing parenthesis. */
function objectSchemas(text: string): { line: number; strict: boolean }[] {
  const found: { line: number; strict: boolean }[] = [];
  // `z\n  .object(` too: a line break must not hide a schema from this test.
  for (const match of text.matchAll(/\bz\s*\.object\(/g)) {
    let depth = 1;
    let at = match.index! + match[0].length;
    while (depth > 0 && at < text.length) {
      const ch = text[at++];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    found.push({ line: text.slice(0, match.index).split("\n").length, strict: /^\s*\.strict\(\)/.test(text.slice(at)) });
  }
  return found;
}

/** Source files outside lib/actions that are, or contain, server actions. */
function useServerElsewhere(): { file: string; fileLevel: boolean; inline: string[] }[] {
  const out: { file: string; fileLevel: boolean; inline: string[] }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) {
        const text = readFileSync(path, "utf8").replace(/\r/g, "");
        const fileLevel = /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(text);
        // An inline action: a function whose body opens with "use server".
        const inline = [...text.matchAll(/function\s+(\w+)\(([^)]*)\)[^{]*\{\s*["']use server["']/g)].map((m) => `${m[1]}(${m[2]!.trim()})`);
        if (fileLevel || inline.length) out.push({ file: relative(process.cwd(), path).replace(/\\/g, "/"), fileLevel, inline });
      }
    }
  };
  for (const root of ["app", "lib", "components"]) walk(join(process.cwd(), root));
  return out;
}

describe("every server action validates what it is sent", () => {
  const files = actionFiles();
  const all = files.flatMap(actionsIn);

  it("finds the actions at all (a reader that finds nothing would pass everything)", () => {
    expect(files.length).toBeGreaterThan(25);
    expect(all.length).toBeGreaterThan(100);
    expect(all.find((a) => a.name === "cancelClientMembershipAction")?.params).toEqual(["merchantId", "membershipId", "input"]);
    expect(all.find((a) => a.name === "clientAddToCartAction")?.params).toEqual(["slug", "kind", "id", "qty"]);
    expect(all.find((a) => a.name === "clientCheckoutAction")?.params).toEqual(["slug", "rewardId", "options"]);
  });

  it("server actions live in lib/actions, and inline ones take no arguments", () => {
    const stray = useServerElsewhere().filter((f) => !f.file.startsWith("lib/actions/"));
    expect(stray.filter((f) => f.fileLevel).map((f) => f.file)).toEqual([]);
    const withArgs = stray.flatMap((f) => f.inline.filter((sig) => !/\(\)$/.test(sig)).map((sig) => `${f.file}: ${sig}`));
    expect(withArgs).toEqual([]);
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

  it("the check comes before anything else is done", () => {
    const late = all
      .filter((action) => action.params.length > 0)
      .filter((action) => {
        const check = action.body.indexOf("validArgs(");
        const firstEffect = action.body.search(/\b(db|rawDb|tx)\.\w+\.\w+\(|\brequire\w*\(|\bawait\b/);
        return check >= 0 && firstEffect >= 0 && firstEffect < check;
      })
      .map((action) => `${action.file}: ${action.name}`);
    expect(late).toEqual([]);
  });

  it("no action file uses a schema that lets an arbitrary object through", () => {
    const loose: string[] = [];
    for (const file of files) {
      source(file)
        .split("\n")
        .forEach((line, i) => {
          if (LOOSE.some((re) => re.test(line))) loose.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(loose).toEqual([]);
  });

  it("every object schema in an action file is strict, so unknown keys are refused", () => {
    const lax = files.flatMap((file) => objectSchemas(source(file)).filter((o) => !o.strict).map((o) => `${file}:${o.line}`));
    // z.object({...}).strict() — then .extend/.refine as needed.
    expect(lax).toEqual([]);
  });

  it("has no stale exemptions", () => {
    for (const key of Object.keys(EXEMPT)) {
      const [file, name, param] = key.split(":");
      const action = all.find((a) => a.file === file && a.name === name);
      expect(action?.params.includes(param!), `${key} is exempted but does not exist`).toBe(true);
    }
  });
});
