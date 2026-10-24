import "server-only";
import { headers } from "next/headers";

/** The caller's address, for rate limiting — inside a server action or route handler. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
