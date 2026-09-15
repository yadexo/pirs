"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { resolveDestination, canReach, safeNext } from "@/lib/login-destination";
import { recordActivity } from "@/lib/activity";
import { getTenantDb } from "@/lib/tenant-db";

export type ActionResult = { error: string } | never;

async function signInOrError(params: Record<string, string>, redirectTo: string): Promise<{ error: string } | void> {
  try {
    await signIn("credentials", { ...params, redirectTo });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw err; // NEXT_REDIRECT on success — must propagate uncaught
  }
}

export async function customerSignInAction(tenantSlug: string, _prevState: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // `next` is form input, so only a same-origin path is honoured; the default
  // is the client app itself (the old /:tenant customer app no longer exists).
  const next = safeNext(String(formData.get("next") ?? "") || undefined) ?? `/app/${tenantSlug}`;
  if (!email || !password) return { error: "Email and password are required." };
  return signInOrError({ portal: "customer", tenantSlug, email, password }, next);
}

/**
 * The single sign-in used by /login. Role decides the landing page, so no
 * workspace slug or portal picker is asked of the user.
 */
export async function unifiedSignInAction(_prevState: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const user = await rawDb.user.findFirst({
    where: { email: email.toLowerCase(), role: { in: ["PLATFORM_ADMIN", "TENANT_ADMIN", "STAFF", "CUSTOMER"] } },
    select: { role: true, tenantId: true, tenant: { select: { slug: true } } },
  });

  const next = String(formData.get("next") ?? "") || null;

  // Unknown address: still attempt the sign-in so the failure message is the
  // same either way, rather than leaking which emails exist.
  let destination = "/login";
  if (user) {
    const actor = { role: user.role, tenantId: user.tenantId, tenantSlug: user.tenant?.slug ?? null };
    // Signing in at a door this account cannot open — say so, rather than
    // dropping them into a different portal — a clinic admin who signs in at the
    // Admin door used to land silently in the clinic UI. Bounce back to the same door, where the page explains it.
    // Checked only after the password succeeds, so it cannot be used to
    // discover which addresses exist or what role they hold.
    destination = canReach(actor, next) ? resolveDestination(actor, next) : `/login?next=${encodeURIComponent(next!)}`;
  }

  return signInOrError({ portal: "unified", email, password }, destination);
}

const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(80),
  lastName: z.string().min(1, "Last name is required").max(80),
  email: z.string().email("Enter a valid email"),
  phone: z.string().max(30).optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  marketingConsent: z.boolean().optional(),
});

export async function customerRegisterAction(tenantSlug: string, _prevState: unknown, formData: FormData) {
  const parsed = registerSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    password: formData.get("password"),
    marketingConsent: formData.get("marketingConsent") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { firstName, lastName, email, phone, password, marketingConsent } = parsed.data;

  const { ok } = await rateLimit(`register:${tenantSlug}:${email.toLowerCase()}`, 5, 15 * 60 * 1000);
  if (!ok) return { error: "Too many attempts. Try again later." };

  const tenant = await rawDb.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant || tenant.status !== "ACTIVE") return { error: "This clinic is not available." };

  const existing = await rawDb.user.findFirst({
    where: { tenantId: tenant.id, email: email.toLowerCase(), role: "CUSTOMER" },
  });
  if (existing) return { error: "An account with this email already exists." };

  const passwordHash = await hashPassword(password);

  const created = await rawDb.user.create({
    select: { customerProfile: { select: { id: true } } },
    data: {
      tenantId: tenant.id,
      email: email.toLowerCase(),
      passwordHash,
      role: "CUSTOMER",
      customerProfile: {
        create: {
          tenantId: tenant.id,
          firstName,
          lastName,
          phone,
          marketingConsent: !!marketingConsent,
          emailConsent: true,
        },
      },
    },
  });

  await recordActivity(getTenantDb(tenant.id), {
    type: "SIGNUP",
    customerProfileId: created.customerProfile?.id,
    summary: "Joined the app",
  });

  return signInOrError({ portal: "customer", tenantSlug, email, password }, `/app/${tenantSlug}`);
}
