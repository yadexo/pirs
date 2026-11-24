/**
 * A list of checkboxes the server reads with getAll() must send the ids.
 *
 * A checkbox with no value attribute submits the string "on". The package
 * form's treatment list and the role editor's permission list both did: every
 * package save failed with "Choose treatments from this clinic", and a role
 * could not be saved with any permission. This finds every field name a server
 * action reads with getAll(), and checks each checkbox using that name in a
 * form passes a value.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckboxField } from "@/components/merchant/form";

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.test(name) ? [path] : [];
  });
}

/** Field names a server action reads as a list. */
const LIST_FIELDS = new Set(
  files("lib/actions", /\.ts$/).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/(?:fd|formData)\.getAll\("([A-Za-z]+)"\)/g)].map((m) => m[1]!)),
);

/** Every checkbox element (CheckboxField or a raw input) and its props text. */
function checkboxes(source: string): { name: string; props: string }[] {
  const found: { name: string; props: string }[] = [];
  for (const m of source.matchAll(/<CheckboxField\b([\s\S]*?)\/>/g)) {
    const name = /name="([A-Za-z]+)"/.exec(m[1]!)?.[1];
    if (name) found.push({ name, props: m[1]! });
  }
  for (const m of source.matchAll(/<input\b([^>]*type="checkbox"[^>]*)\/?>/g)) {
    const name = /name=(?:"([A-Za-z]+)"|\{name\})/.exec(m[1]!);
    if (name?.[1]) found.push({ name: name[1], props: m[1]! });
  }
  return found;
}

describe("checkbox lists", () => {
  it("knows the list fields it is guarding", () => {
    for (const name of ["serviceIds", "permissions", "productIds"]) expect(LIST_FIELDS.has(name), name).toBe(true);
  });

  it("every checkbox for a list field sends a value, not \"on\"", () => {
    const problems: string[] = [];
    for (const file of [...files("app", /\.tsx$/), ...files("components", /\.tsx$/)]) {
      for (const box of checkboxes(readFileSync(file, "utf8"))) {
        if (LIST_FIELDS.has(box.name) && !/\bvalue=/.test(box.props)) problems.push(`${file.replace(/\\/g, "/")}: ${box.name} has no value`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("CheckboxField puts its value on the input", () => {
    const html = renderToStaticMarkup(createElement(CheckboxField, { name: "serviceIds", value: "svc_123", label: "Facial", checked: true, onChange: () => undefined }));
    expect(html).toContain('value="svc_123"');
  });
});
