/**
 * The one registration setting the browser needs too.
 *
 * Its own module because lib/registration-code.ts is `server-only` — it reads
 * the code itself — and the register form has to show the same minimum the
 * server enforces. A number, nothing secret: what the code *is* never leaves
 * the server.
 *
 * Twelve, not the eight lib/password-tokens.ts allows for a reset. A password
 * typed on a public form, on an account that is usable the moment it is
 * submitted, is the weakest moment either flow has.
 */
export const REGISTRATION_MIN_PASSWORD_LENGTH = 12;
