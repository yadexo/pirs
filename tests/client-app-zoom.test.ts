import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { clientAppViewport } from "@/lib/client-app-viewport";
import { blockPinchZoom } from "@/components/client-app/zoom-lock";

/**
 * The client app is installed on a phone and held at one scale, so it reads
 * as an app rather than a web page. Taking a client's zoom away is only
 * defensible if nothing in the app needed zooming into — which is why the
 * type floor and the contrast of the text tokens are tested here too, beside
 * the thing that removed the zoom.
 *
 * None of this applies to the clinic dashboard or the agency panel: those are
 * desktop tools where zooming is a normal thing to want.
 */

const CLIENT_APP_DIRS = ["app/app", "components/client-app"];
const CSS = "app/app/[merchantSlug]/client-app.css";

/** The smallest text a client should ever be asked to read without zooming. */
const TYPE_FLOOR_PX = 14;

/**
 * A logo in a tile, not a sentence: the Klarna wordmark sits at the size the
 * tile allows, and the label next to it carries the meaning. Anything else
 * appearing here should be argued for in the same way.
 */
const NOT_TEXT = /klarna/i;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of CLIENT_APP_DIRS) walk(dir);
  return out;
}

describe("the client app's viewport", () => {
  it("fixes the scale, so pinch and double-tap can't zoom the app", () => {
    expect(clientAppViewport).toMatchObject({ width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false });
  });

  it("still reaches under the notch, which the safe-area insets depend on", () => {
    // --sat/--sab in client-app.css are env(safe-area-inset-*), and those are
    // zero without viewport-fit=cover.
    expect(clientAppViewport.viewportFit).toBe("cover");
    expect(readFileSync(CSS, "utf8")).toContain("env(safe-area-inset-top");
  });

  it("is the only viewport the client app declares, so the two routes agree", () => {
    const declarers = sourceFiles().filter((f) => /export const viewport/.test(readFileSync(f, "utf8")));
    // The clinic app's layout and the find-your-clinic page, both from the
    // shared definition — a second hand-written one would drift.
    for (const file of declarers) {
      expect(readFileSync(file, "utf8"), file).toContain("clientAppViewport");
    }
    expect(declarers.length).toBeGreaterThan(0);
  });

  it("leaves the clinic dashboard and the agency panel able to zoom", () => {
    const root = readFileSync("app/layout.tsx", "utf8");
    expect(root).not.toContain("userScalable");
    expect(root).not.toContain("maximumScale");
  });
});

describe("refusing a pinch", () => {
  it("refuses WebKit's gesture events, which is all iOS leaves us in a tab", () => {
    const handlers = new Map<string, EventListenerOrEventListenerObject>();
    const options: AddEventListenerOptions[] = [];
    const target = {
      addEventListener: (name: string, handler: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions) => {
        handlers.set(name, handler);
        if (opts) options.push(opts);
      },
      removeEventListener: (name: string) => handlers.delete(name),
    };

    const stop = blockPinchZoom(target);

    // Only the two-finger zoom gestures: scrolling and tapping are untouched,
    // and so is the camera in the QR scanner.
    expect([...handlers.keys()]).toEqual(["gesturestart", "gesturechange", "gestureend"]);
    // A passive listener cannot preventDefault, which would make all of this
    // quietly do nothing.
    expect(options.every((o) => o.passive === false)).toBe(true);

    const preventDefault = vi.fn();
    (handlers.get("gesturestart") as EventListener)({ preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalled();

    stop();
    expect(handlers.size).toBe(0);
  });
});

describe("the app's touch behaviour", () => {
  const css = readFileSync(CSS, "utf8");

  it("drops double-tap zoom across the app", () => {
    expect(css).toMatch(/\.client-app\s*\{[^}]*touch-action: manipulation/s);
  });

  it("says it again on everything you can tap", () => {
    expect(css).toMatch(/\.client-app button,[\s\S]*?touch-action: manipulation/);
  });

  it("keeps the gestures the app is built on", () => {
    // Dragging a sheet closed, and swiping a cart row to remove it. Both
    // declare their own stricter touch-action, and the browser intersects
    // those with the app's — so they must still be there.
    expect(css).toMatch(/\.grab\s*\{[^}]*touch-action: none/s);
    expect(css).toMatch(/\.cin\s*\{[^}]*touch-action: pan-y/s);
  });

  it("holds the text size when the phone is rotated", () => {
    expect(css).toContain("-webkit-text-size-adjust: 100%");
  });
});

describe("text a client cannot zoom into", () => {
  it("never asks a field for text under 16px, which would zoom iOS in", () => {
    const css = readFileSync(CSS, "utf8");
    expect(css).toMatch(/\.client-app input,\s*\.client-app select,\s*\.client-app textarea\s*\{\s*font-size: 16px/);

    // And no rule anywhere sets a field smaller than that.
    const fields = css.matchAll(/(input|select|textarea)[^{]*\{([^}]*)\}/g);
    for (const [, field, body] of fields) {
      const size = /font-size:\s*(\d+)px/.exec(body ?? "");
      if (size) expect(Number(size[1]), `${field} at ${size[1]}px`).toBeGreaterThanOrEqual(16);
    }
  });

  it(`sets nothing in the stylesheet below ${TYPE_FLOOR_PX}px`, () => {
    const offenders = readFileSync(CSS, "utf8")
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => {
        const match = /font-size:\s*(\d+)px/.exec(line);
        return match !== null && Number(match[1]) < TYPE_FLOOR_PX;
      });

    // The brand mark is allowed; it is a logo, not a sentence. Everything
    // else is a line somebody has to read on a phone they cannot zoom.
    const notAllowed = offenders.filter(([n]) => {
      const context = readFileSync(CSS, "utf8").split("\n").slice(Math.max(0, n - 12), n).join("\n");
      return !NOT_TEXT.test(context);
    });
    expect(notAllowed.map(([n, line]) => `${CSS}:${n} ${line.trim()}`)).toEqual([]);
  });

  it(`sets nothing in the client app's components below ${TYPE_FLOOR_PX}px`, () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (NOT_TEXT.test(line)) return;
          for (const match of line.matchAll(/fontSize: (\d+)/g)) {
            if (Number(match[1]) < TYPE_FLOOR_PX) offenders.push(`${relative(".", file).replace(/\\/g, "/")}:${i + 1} ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("colours text only with tokens that clear WCAG AA", () => {
    const css = readFileSync(CSS, "utf8");
    const token = (name: string) => {
      const match = new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(css);
      if (!match) throw new Error(`no --${name} token`);
      return match[1]!;
    };

    const luminance = (hex: string) => {
      const parts = hex.slice(1).match(/../g)!.map((v) => parseInt(v, 16) / 255);
      const [r, g, b] = parts.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };

    // Every background these sit on, worst case included.
    const backgrounds = ["bg-surface", "bg-app", "pill-bg"].map(token);
    for (const name of ["ink", "ink-strong", "muted", "danger"]) {
      for (const background of backgrounds) {
        expect(contrast(token(name), background), `--${name} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps --faint for decoration, never for words", () => {
    // 1.9:1 against white: fine for a page dot or a hairline, unreadable as
    // text, and there is no zoom to rescue it with.
    for (const file of sourceFiles()) {
      const content = readFileSync(file, "utf8");
      for (const line of content.split("\n")) {
        if (!/color: "var\(--faint\)"/.test(line)) continue;
        expect(line, `${relative(".", file).replace(/\\/g, "/")}: --faint used with text`).not.toMatch(/fontSize|textAlign/);
      }
    }
  });
});
