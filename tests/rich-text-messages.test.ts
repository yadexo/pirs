/**
 * Every function handed to t.rich() is a tag in the message it formats.
 *
 * next-intl calls a function value only for a tag — `<b>…</b>`, `<icon></icon>`.
 * For a plain placeholder — `{email}` — it inserts the value as it is, so a
 * function there ends up in the rendered output as a function. React cannot
 * serialise that, and the page fails with the generic error page.
 *
 * That is exactly how /set-password broke: "For {email}." with
 * `email: () => <span>…</span>` took down every valid invitation and reset
 * link, on every host, while an expired link — the other branch — rendered
 * fine. This reads every t.rich() call, works out which of its values are
 * functions, and checks each of them is a tag (and not a placeholder) in
 * every locale's message for that key.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import nl from "@/messages/nl.json";

const LOCALES = { en, nl } as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every leaf message, with its full key. */
function leaves(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

/** The text of a balanced (...) or {...} starting at `open`. */
function balanced(source: string, open: number): string {
  const pairs: Record<string, string> = { "(": ")", "{": "}" };
  const close = pairs[source[open]!]!;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === source[open]) depth++;
    else if (source[i] === close && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

/** Names whose value in this object literal is a function (inline, or a local const that is one). */
function functionValued(objectText: string, source: string): string[] {
  const names = new Set<string>();
  for (const m of objectText.matchAll(/(\w+)\s*:\s*(\([^)]*\)\s*=>|function\b|\w+\s*=>)/g)) names.add(m[1]!);
  for (const m of objectText.matchAll(/(\w+)\s*:\s*([A-Za-z_]\w*)\s*[,}]?/g)) {
    if (new RegExp(`const\\s+${m[2]}\\s*=\\s*(\\([^)]*\\)|\\w+)\\s*=>`).test(source)) names.add(m[1]!);
  }
  return [...names];
}

/** The string literals in a key expression that are message keys: not the ones it compares against (`os === "IPADOS" ? "a" : "b"`). */
function keyLiterals(expression: string): string[] {
  return [...expression.replace(/[!=]==?\s*"[^"]*"/g, "").matchAll(/"([^"]+)"/g)].map((k) => k[1]!);
}

interface RichCall {
  file: string;
  keys: string[];
  functions: string[];
}

function richCalls(): RichCall[] {
  const calls: RichCall[] = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/\bt\.rich\(/g)) {
      const args = balanced(source, m.index! + m[0].length - 1);
      const comma = args.indexOf(",");
      const keyExpr = comma === -1 ? args : args.slice(0, comma);
      const objectStart = args.indexOf("{", comma);
      const functions = objectStart === -1 ? [] : functionValued(balanced(args, objectStart), source);
      let keys = keyLiterals(keyExpr);
      // A helper like `const rich = (key: string) => t.rich(key, {...})`: its
      // keys are the literals it is called with (not `t.rich(` itself).
      const helper = /const\s+(\w+)\s*=\s*\(\s*(\w+)[^)]*\)\s*=>\s*$/.exec(source.slice(0, m.index!));
      if (keys.length === 0 && helper && keyExpr.trim() === helper[2]) {
        for (const use of source.matchAll(new RegExp(`(?<![.\\w])${helper[1]}\\(`, "g"))) {
          keys.push(...keyLiterals(balanced(source, use.index! + use[0].length - 1)));
        }
      }
      keys = [...new Set(keys)];
      if (functions.length) calls.push({ file: file.replace(/\\/g, "/"), keys, functions });
    }
  }
  return calls;
}

describe("rich-text messages", () => {
  const calls = richCalls();

  it("finds the calls it is meant to check, including the set-password page", () => {
    expect(calls.find((c) => c.file === "app/set-password/page.tsx")).toBeDefined();
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it("every function value is a tag, never a {placeholder}, in every locale", () => {
    const problems: string[] = [];
    for (const call of calls) {
      expect(call.keys.length, `${call.file}: could not read the message key of a t.rich() call`).toBeGreaterThan(0);
      for (const key of call.keys) {
        for (const [locale, messages] of Object.entries(LOCALES)) {
          const matches = leaves(messages).filter(([path]) => path === key || path.endsWith(`.${key}`));
          if (matches.length === 0) problems.push(`${call.file}: no ${locale} message named ${key}`);
          for (const [path, text] of matches) {
            for (const name of call.functions) {
              if (new RegExp(`\\{\\s*${name}\\s*[,}]`).test(text)) problems.push(`${locale} ${path}: {${name}} is a placeholder, but ${call.file} passes a function — use <${name}>…</${name}>`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
