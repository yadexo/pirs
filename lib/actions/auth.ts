"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { clientSignIn } from "@/client-auth";
import { rawDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { rateLimit, retryAfterLabel } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { resolveDestination, canReach, safeNext } from "@/lib/login-destination";
import { recordActivity } from "@/lib/activity";
import { currentClientBasePath } from "@/lib/public-clinic";
import { getTenantDb } from "@/lib/tenant-db";
import { absoluteClientAppUrl } from "@/lib/client-app-url";
import { getEmailProvider } from "@/lib/providers/notifications";
import { senderFor } from "@/lib/emails/sender";
import { welcomeClientEmail } from "@/lib/emails/templates";

export type ActionResult = { error: string } | never;

async function signInOrError(
  params: Record<string, string>,
  redirectTo: string,
  audience: "staff" | "client",
): Promise<{ error: string } | void> {
  try {
    await (audience === "client" ? clientSignIn : signIn)("credentials", { ...params, redirectTo });
  } catch (err) {
    if (err instanceof AuthError) {
      // Rate-limit failures carry their own message (see RateLimitedSignIn,
      // lib/auth-credentials.ts); a wrong password never does, and stays
      // generic on purpose — a different message would say which part was
      // wrong.
      return { error: err.message || "Invalid email or password." };
    }
    throw err; // NEXT_REDIRECT on success — must propagate uncaught
  }
}

export async function customerSignInAction(tenantSlug: string, _prevState: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // `next` is form input, so only a same-origin path is honoured; the default
  // is the client app itself (the old /:tenant customer app no longer exists).
  const next = safeNext(String(formData.get("next") ?? "") || undefined) ?? (await currentClientBasePath(tenantSlug));
  if (!email || !password) return { error: "Email and password are required." };
  return signInOrError({ portal: "customer", tenantSlug, email, password }, next, "client");
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

  // Clients get the client app's session; everyone else the staff session.
  return signInOrError({ portal: "unified", email, password }, destination, user?.role === "CUSTOMER" ? "client" : "staff");
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

  const ip = await clientIp();
  const [byAccount, byIp] = await Promise.all([
    rateLimit(`register:${tenantSlug}:${email.toLowerCase()}`, 5, 15 * 60 * 1000),
    rateLimit(`register:ip:${ip}`, 20, 15 * 60 * 1000),
  ]);
  const limited = !byAccount.ok ? byAccount : !byIp.ok ? byIp : null;
  if (limited) return { error: `Too many attempts. Try again in ${retryAfterLabel(limited.retryAfterMs)}.` };

  const tenant = await rawDb.tenant.findUnique({
    where: { slug: tenantSlug },
    include: { branding: { select: { businessName: true, logoUrl: true, primaryColor: true } } },
  });
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

  const clinicName = tenant.branding?.businessName ?? tenant.name;
  const template = welcomeClientEmail({
    branding: { name: clinicName, logoUrl: tenant.branding?.logoUrl ?? null, color: tenant.branding?.primaryColor ?? null },
    firstName,
    openAppUrl: absoluteClientAppUrl(tenantSlug),
  });
  await getEmailProvider()
    .send({ to: email, subject: template.subject, body: template.text, html: template.html, from: senderFor(clinicName) })
    .catch((err) => console.error("[register] welcome email not sent:", err instanceof Error ? err.message : err));

  return signInOrError({ portal: "customer", tenantSlug, email, password }, await currentClientBasePath(tenantSlug), "client");
}
