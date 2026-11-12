import { z } from "zod";

/**
 * Checking what a server action was actually sent.
 *
 * A server action is a public HTTP endpoint. Its TypeScript signature
 * describes what this app's own code passes; it says nothing about what
 * arrives. `qty: number` did not stop a quantity of minus one, and an order
 * completed for free (docs/security/review-2026-11.md, P-1). That was one
 * instance of a habit — arguments declared and then used on trust — and this
 * is the end of the habit (R-2): every client-side action checks every
 * argument with `validArgs` before it does anything else.
 *
 * "Every" is not left to memory. tests/action-args-coverage.test.ts reads the
 * action files and fails for any exported action whose parameters are not all
 * named in a `validArgs` call.
 *
 * Deliberately a check and not a transformation: nothing is coerced, trimmed
 * or defaulted, so after it passes the arguments are exactly what was sent
 * and exactly what the signature says. A string where a number belongs is not
 * "close enough" — the app never sends one, so somebody else did.
 */
export function validArgs<S extends z.ZodTypeAny>(schema: S, args: readonly unknown[]): boolean {
  return schema.safeParse(args).success;
}

/**
 * The one answer for a malformed request. Whoever receives it is not using
 * the app, and is owed no hint about which argument was wrong or why.
 */
export const INVALID_REQUEST = "That request couldn't be understood.";

/** For the few actions whose return type has no room for an error. */
export class InvalidActionArgsError extends Error {
  constructor() {
    super(INVALID_REQUEST);
    this.name = "InvalidActionArgsError";
  }
}

/**
 * The shapes arguments come in. Bounded on purpose: every string has a
 * maximum, so nothing reaches a query, a log line or an error message at a
 * length somebody chose for us.
 */
export const arg = {
  /** A clinic's slug, as it appears in a URL. */
  slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  /** A database id (cuid) or anything shaped like one. Never a pattern, a path or an object. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  /** "ORD-MWC49P8Y-DWB_": what checkout mints. */
  orderNumber: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  /** A point in time as the browser sends it. Must actually be one. */
  isoDate: z
    .string()
    .max(40)
    .refine((value) => !Number.isNaN(Date.parse(value))),
  /** Free text someone typed: a search, an email address, a phone number. */
  text: (max: number) => z.string().max(max),
  /** A whole number in a stated range. Not NaN, not a fraction, not Infinity. */
  int: (min: number, max: number) => z.number().int().min(min).max(max),
} as const;

/** `z.tuple`, re-exported so action files need one import for this. */
export const args = z.tuple;
