import { config } from "dotenv";
import { vi } from "vitest";

config({ path: ".env.test" });

// Server actions call these Next.js runtime helpers, which throw outside of
// an actual request context. Stub them so action code under test can run in
// plain Node — a thrown "redirect" signals a successful action, which tests
// catch and assert around; revalidatePath is a no-op we don't need to verify.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
