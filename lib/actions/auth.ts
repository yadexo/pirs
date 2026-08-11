"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { resolveDestination } from "@/lib/login-destination";

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
  const next = String(formData.get("next") ?? `/${tenantSlug}`);
  if (!email || !password) return { error: "Email and password are required." };
  return signInOrError({ portal: "customer", tenantSlug, email, password }, next);
}

export async function staffSignInAction(_prevState: unknown, formData: FormData) {
  const workspace = String(formData.get("workspace") ?? "").trim();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");
  if (!workspace || !email || !password) return { error: "Workspace, email, and password are required." };
  return signInOrError({ portal: "staff", tenantSlug: workspace, email, password }, next);
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

  // Unknown address: still attempt the sign-in so the failure message is the
  // same either way, rather than leaking which emails exist.
  const destination = user
    ? resolveDestination(
        { role: user.role, tenantId: user.tenantId, tenantSlug: user.tenant?.slug ?? null },
        String(formData.get("next") ?? "") || null,
      )
    : "/login";

  return signInOrError({ portal: "unified", email, password }, destination);
}

export async function platformSignInAction(_prevState: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };
  return signInOrError({ portal: "platform", email, password }, "/platform");
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

  const { ok } = rateLimit(`register:${tenantSlug}:${email.toLowerCase()}`, 5, 15 * 60 * 1000);
  if (!ok) return { error: "Too many attempts. Try again later." };

  const tenant = await rawDb.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant || tenant.status !== "ACTIVE") return { error: "This clinic is not available." };

  const existing = await rawDb.user.findFirst({
    where: { tenantId: tenant.id, email: email.toLowerCase(), role: "CUSTOMER" },
  });
  if (existing) return { error: "An account with this email already exists." };

  const passwordHash = await hashPassword(password);

  await rawDb.user.create({
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

  return signInOrError({ portal: "customer", tenantSlug, email, password }, `/${tenantSlug}`);
}
