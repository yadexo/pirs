import { describe, it, expect } from "vitest";
import { isRealProduction } from "@/lib/deploy-env";

describe("isRealProduction", () => {
  it("is only true on Vercel's own Production deployment", () => {
    expect(isRealProduction({ VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isRealProduction({ VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isRealProduction({ VERCEL_ENV: "development" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isRealProduction({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("also honours an explicit APP_ENV=production for a non-Vercel host", () => {
    expect(isRealProduction({ APP_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isRealProduction({ APP_ENV: "staging" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("defaults to non-production for an unset or unrecognised value, never guessing production", () => {
    expect(isRealProduction({ VERCEL_ENV: "", APP_ENV: "" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isRealProduction({ VERCEL_ENV: "staging" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
