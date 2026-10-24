/**
 * The security headers every response gets, built once per request so the
 * Content-Security-Policy can carry a nonce — see middleware.ts, the only
 * caller. Kept here, not inline, so the policy itself can be unit tested
 * without booting a request.
 *
 * Stripe needs real exceptions: Stripe.js, the Payment Element and the Apple
 * Pay sheet run inside Stripe's own iframes and call Stripe's own API, so
 * js.stripe.com and api.stripe.com are named explicitly rather than left out
 * and discovered later as "payments are broken".
 *
 * script-src is nonce-only — no 'unsafe-inline' — because the one inline
 * script this app ships (the launch-screen splash,
 * components/client-app/splash.tsx) carries this same nonce. style-src does
 * allow 'unsafe-inline': the only inline style in the app is one developer-
 * written <style> tag (the bottom-sheet's keyframes, in a client component
 * that has no way to receive a per-request nonce), and inline CSS is a much
 * narrower risk than inline script — this app has no user-authored CSS
 * anywhere for it to carry.
 */
export function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' is what makes this work with Next's own code-split
    // chunks: without it, a nonce only trusts the scripts that carry it
    // directly, not the ones Next's webpack runtime injects afterwards via
    // document.createElement("script") for lazy-loaded routes and
    // components — those have no nonce of their own to present, and were
    // silently refused ("An unknown error occurred when fetching the
    // script") until this was added. 'strict-dynamic' extends trust from an
    // already-nonce'd script to whatever script *that* script creates, which
    // is exactly webpack's loading pattern. https://js.stripe.com stays
    // listed for browsers old enough to ignore 'strict-dynamic'.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "https://js.stripe.com"],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Clinic logos and product photos can live on any host a clinic's own S3
    // bucket uses (see STORAGE_PROVIDER in .env.example) — as permissive as
    // next.config.mjs's own images.remotePatterns already is for the same reason.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", "https://api.stripe.com", "https://js.stripe.com"],
    "frame-src": ["https://js.stripe.com", "https://hooks.stripe.com"],
    // The client app's service worker (public/client-sw.js) runs in a worker
    // context, which script-src's nonce does not cover without this — it
    // registered as a silent failure, caught only by actually loading the
    // client app and checking navigator.serviceWorker.getRegistrations().
    "worker-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
}

/** Applies every security header to a response, given the nonce already baked into its CSP. */
export function applySecurityHeaders(headers: Headers, nonce: string, isHttps: boolean, opts: { skipCsp?: boolean } = {}): void {
  if (!opts.skipCsp) headers.set("Content-Security-Policy", buildCsp(nonce));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // The modern, CSP-native equivalent is frame-ancestors above; this header
  // is kept alongside it for browsers too old to read CSP2.
  headers.set("X-Frame-Options", "DENY");
  // Only over a connection that is actually HTTPS — a browser that cached
  // this header for plain-HTTP localhost would refuse to load it at all.
  if (isHttps) headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
}
