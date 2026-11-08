/**
 * How hard sign-in is rate-limited. One place, so the code that enforces the
 * limits (lib/auth-credentials.ts) and the report that explains a lockout
 * (prisma/list-platform-admins.ts) cannot disagree about them.
 *
 * The window is fixed, not sliding: it starts at the first attempt and the
 * counter resets when it ends, so a lock never lasts longer than one window.
 */
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_ATTEMPTS_PER_ACCOUNT = 10;
export const LOGIN_ATTEMPTS_PER_IP = 30;
