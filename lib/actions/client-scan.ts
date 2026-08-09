"use server";

import { createHmac } from "node:crypto";
import { requireCustomerContext } from "@/lib/rbac";

const TTL_SECONDS = 120;

/**
 * Mints a short-lived signed check-in token for the Scan tab. Signed with
 * AUTH_SECRET so the merchant side can verify it came from us and has not
 * expired — a screenshotted code stops working after TTL_SECONDS.
 */
export async function mintScanTokenAction(): Promise<string> {
  const { user } = await requireCustomerContext();
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const body = `${user.customerProfileId}.${expiresAt}`;
  const signature = createHmac("sha256", process.env.AUTH_SECRET ?? "").update(body).digest("base64url").slice(0, 16);
  return `${body}.${signature}`;
}

/** Verifies a scanned token. Used by the merchant-side scanner. */
export async function verifyScanToken(token: string): Promise<{ customerProfileId: string } | null> {
  const [customerProfileId, expiresRaw, signature] = token.split(".");
  if (!customerProfileId || !expiresRaw || !signature) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;

  const expected = createHmac("sha256", process.env.AUTH_SECRET ?? "")
    .update(`${customerProfileId}.${expiresRaw}`)
    .digest("base64url")
    .slice(0, 16);
  if (expected !== signature) return null;

  return { customerProfileId };
}
