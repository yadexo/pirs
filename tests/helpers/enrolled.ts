/**
 * A confirmed second factor, for a fixture owner or platform admin.
 *
 * Both roles must have two-factor before they may do anything at all
 * (lib/rbac.ts, `mustSetUpTwoFactorFirst`) — that is enforced under every
 * guard, so a fixture without it is refused exactly as a real account would
 * be. Tests that are about something else give their admins this; tests
 * about the refusal itself leave it off on purpose.
 *
 * Use as a nested create:
 *   rawDb.user.create({ data: { ..., role: "TENANT_ADMIN", twoFactor: ENROLLED } })
 *
 * The secret is a fixed, well-known test value. Nothing here signs in with a
 * code; the guards only ask whether setup was confirmed.
 */
export const ENROLLED = { create: { secret: "JBSWY3DPEHPK3PXP", confirmedAt: new Date("2026-01-01T00:00:00Z") } } as const;
