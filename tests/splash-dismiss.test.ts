import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dismissDurationMs } from "@/components/client-app/splash-dismiss";

describe("dismissDurationMs", () => {
  it("uses the CSS custom property's own value", () => {
    expect(dismissDurationMs("220ms")).toBe(220);
    expect(dismissDurationMs("450ms")).toBe(450);
  });

  it("falls back to 220 for anything that isn't a positive number — missing, empty, zero, negative, or garbage", () => {
    for (const raw of [null, "", "0ms", "-10ms", "not-a-number", "   "]) {
      expect(dismissDurationMs(raw)).toBe(220);
    }
  });
});

/**
 * The launch screen's guaranteed dismiss (splash-dismiss.tsx) exists
 * specifically because the fast path — Splash's own inline <script nonce> —
 * only runs when its nonce matches the CSP the browser already locked onto
 * the document, which a soft (client-side) navigation into this layout can
 * fail on some engines (see that file's own comment). A regression here
 * would bring that bug straight back with no visible diff in the component
 * that changed. No DOM harness in this project's test environment
 * (environment: "node") to render the layout and check the real DOM, so
 * this is the structural guarantee instead: the wiring itself can't go
 * missing silently.
 */
describe("the client app layout always renders both halves of the launch screen", () => {
  const layoutSource = readFileSync("app/app/[merchantSlug]/layout.tsx", "utf8");

  it("renders the fast path (the nonce'd inline script)", () => {
    expect(layoutSource).toMatch(/<Splash\b/);
  });

  it("renders the guaranteed path, independent of any nonce matching", () => {
    expect(layoutSource).toMatch(/<SplashDismiss\s*\/>/);
  });
});
