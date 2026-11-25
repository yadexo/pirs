/**
 * A Button submits a form only when it says so.
 *
 * An HTML <button> with no type is a submit button. Forms here nest drawers
 * inside them (the photo cropper sits inside the product form), so every
 * <Button onClick> without a type was a hidden submit: confirming a photo crop
 * saved the product without the photo and closed the form. The Button now
 * defaults to type="button"; anything that submits says type="submit".
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Each <Button …> opening tag's props, braces respected. */
function buttonProps(source: string): { line: number; props: string }[] {
  const out: { line: number; props: string }[] = [];
  let i = 0;
  while ((i = source.indexOf("<Button", i)) !== -1) {
    if (!/[\s>]/.test(source[i + 7] ?? "")) {
      i += 7;
      continue;
    }
    let depth = 0;
    let j = i + 7;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ line: source.slice(0, i).split("\n").length, props: source.slice(i + 7, j) });
    i = j;
  }
  return out;
}

describe("Button", () => {
  it("is not a submit button unless asked", () => {
    expect(renderToStaticMarkup(createElement(Button, null, "Use this crop"))).toContain('type="button"');
    expect(renderToStaticMarkup(createElement(Button, { type: "submit" }, "Save"))).toContain('type="submit"');
  });

  it("the photo cropper's buttons cannot submit the form around them", () => {
    const crop = readFileSync("components/merchant/image-crop.tsx", "utf8");
    for (const b of buttonProps(crop)) expect(b.props, `image-crop.tsx:${b.line}`).not.toMatch(/type="submit"/);
  });

  it("every Button that submits says so", () => {
    // A Button with neither onClick nor type relied on the old default to
    // submit; with the new default it would silently stop. None may exist.
    const silent: string[] = [];
    for (const file of [...files("app"), ...files("components")]) {
      for (const b of buttonProps(readFileSync(file, "utf8"))) {
        if (!/\btype=/.test(b.props) && !/\bonClick=/.test(b.props) && !/\bdisabled\b/.test(b.props) && !/asChild/.test(b.props)) {
          silent.push(`${file.replace(/\\/g, "/")}:${b.line}`);
        }
      }
    }
    // Inside a <Link> a Button is only a label for the link; that one is fine.
    expect(silent.filter((s) => !s.startsWith("app/m/[merchantId]/page.tsx"))).toEqual([]);
  });
});
