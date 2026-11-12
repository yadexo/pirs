/**
 * How hard sign-in is rate-limited. One place, so the code that enforces the
 * limits (lib/auth-credentials.ts) and the report that explains a lockout
 * (prisma/list-platform-admins.ts) cannot disagree about them.
 *
 * Three limits, and what each is for:
 *
 * 1. Failures on one account from one address — the ordinary case of someone
 *    guessing, or mistyping. Ten in ten minutes, then that address waits.
 * 2. Failures on one account from everywhere put together — a hundred an
 *    hour. This is what bounds a guesser who changes address every time.
 * 3. Attempts from one address at any account — thirty in ten minutes. This
 *    is what catches one password sprayed across many accounts.
 *
 * The first two count failures only. They used to be one limit that counted
 * every attempt on an account, the owner's own successful ones included, from
 * anywhere: ten requests every ten minutes from a stranger kept an owner or a
 * platform admin locked out for as long as the stranger cared to continue,
 * knowing nothing but their email address
 * (docs/security/review-2026-11.md, A-5). Now a stranger's failures count
 * against the stranger's address. Locking the account itself takes a hundred
 * failures an hour — still possible, on purpose, because the alternative is
 * unlimited guessing from a botnet — and it is ten times the work for a
 * tenth of the effect.
 *
 * Every window is fixed, not sliding: it starts at the first one counted and
 * the counter resets when it ends, so a lock never lasts longer than one
 * window.
 */
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_FAILURES_PER_ACCOUNT_AND_SOURCE = 10;
export const LOGIN_ATTEMPTS_PER_IP = 30;

export const LOGIN_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;
export const LOGIN_FAILURES_PER_ACCOUNT = 100;

/**
 * The counter keys. All begin "login:" and the two about an account end with
 * ":<email>" — the scripts that clear a lockout for one address
 * (prisma/reset-platform-admin-password.ts, prisma/reset-platform.ts) match on
 * exactly that, so both are cleared together.
 */
export const loginIpKey = (ip: string) => `login:ip:${ip}`;
export const loginAccountKey = (portal: string, email: string) => `login:${portal}:${email}`;
/** An IPv6 address is full of colons, which are this key's separator. */
export const loginSourceKey = (portal: string, email: string, ip: string) => `login:src:${ip.replace(/:/g, "_")}:${portal}:${email}`;

export type LoginCounter =
  | { kind: "ip"; subject: string; portal: null; from: null; limit: number; windowMs: number }
  | { kind: "account"; subject: string; portal: string; from: null; limit: number; windowMs: number }
  | { kind: "account-from-address"; subject: string; portal: string; from: string; limit: number; windowMs: number };

/** What a counter key is counting, for the lockout report. Null for anything that is not one of ours. */
export function describeLoginKey(key: string): LoginCounter | null {
  if (key.startsWith("login:ip:")) {
    return { kind: "ip", subject: key.slice("login:ip:".length), portal: null, from: null, limit: LOGIN_ATTEMPTS_PER_IP, windowMs: LOGIN_WINDOW_MS };
  }
  if (key.startsWith("login:src:")) {
    const [from = "", portal = "", ...email] = key.slice("login:src:".length).split(":");
    if (!from || !portal || email.length === 0) return null;
    return {
      kind: "account-from-address",
      subject: email.join(":"),
      portal,
      from: from.replace(/_/g, ":"),
      limit: LOGIN_FAILURES_PER_ACCOUNT_AND_SOURCE,
      windowMs: LOGIN_WINDOW_MS,
    };
  }
  if (key.startsWith("login:")) {
    const [, portal = "", ...email] = key.split(":");
    if (!portal || email.length === 0) return null;
    return { kind: "account", subject: email.join(":"), portal, from: null, limit: LOGIN_FAILURES_PER_ACCOUNT, windowMs: LOGIN_ACCOUNT_WINDOW_MS };
  }
  return null;
}

/**
 * Whether a counter at this count is refusing sign-ins.
 *
 * The two failure counters are looked at before an attempt and refuse once
 * the limit has been reached. The address counter counts the attempt itself
 * as it is made, so it refuses the one after the limit.
 */
export function loginCounterLocked(counter: Pick<LoginCounter, "kind" | "limit">, count: number): boolean {
  return counter.kind === "ip" ? count > counter.limit : count >= counter.limit;
}
