# Error monitoring (Sentry) — no SDK

This project reports errors to Sentry over plain HTTP (Sentry's ingest API
accepts a two-line JSON "envelope" from anything that can build one — no SDK
required). The Sentry SDK was tried and reverted early on: bundling it for
the Edge runtime (this app's middleware) took production builds from under a
minute to over ten. See the comment at the top of `lib/observability.ts`.

## 1. Create the Sentry project

1. [sentry.io](https://sentry.io) → **Projects → Create Project**.
2. Platform: pick **Node.js** (there's no dedicated "no SDK" option — Node.js
   is the closest; it only affects Sentry's default issue grouping hints,
   not whether reports arrive).
3. Name it `pirs-production` (and a second project, `pirs-staging`, if you
   want staging's errors kept separate from production's — recommended, so a
   staging bug doesn't page you or pollute production's issue list).
4. **Project Settings → Client Keys (DSN)** — copy the DSN. It looks like:
   ```
   https://abc123def456@o000000.ingest.sentry.io/0000000
   ```

## 2. Environment variables

| Variable | Production | Preview (staging) |
|---|---|---|
| `SENTRY_DSN` | the `pirs-production` project's DSN | the `pirs-staging` project's DSN (if you made a separate one) |

Unset `SENTRY_DSN` anywhere (including local dev) and reporting to Sentry is
simply off — `parseSentryDsn()` returns `null` and nothing is sent; only the
existing `console.error` JSON line still happens. Nothing else needs to
change in code to turn this on or off.

## 3. What gets sent, and what doesn't

Every unhandled error in a route, page, server action or middleware goes
through `lib/observability.ts`'s `buildErrorReport()` first, which keeps
only: the error's name, message and stack trace, the route path and type,
the HTTP method, the request path **with its query string stripped** (a
query string can carry a reset token or a search term that's someone's
email), and the environment (`APP_ENV`, falling back to `NODE_ENV`). Never
headers, cookies, request/response bodies, or who was signed in — see the
test `"has no field that could carry headers, cookies, bodies or identity"`
in `tests/observability.test.ts`, which fails the build if a field is added
without updating that list on purpose.

Each environment tags itself automatically (`environment: "production"` /
`"staging"` / `"development"`), so Sentry's own environment filter separates
them even when both report to the same project.

## 4. The trade-off of not using the SDK

Sentry's dashboard groups issues by parsing the stack trace into structured
frames (`{filename, function, lineno}`); the full SDK does that automatically
client- and server-side. This integration sends the raw stack as a string
extra field instead and lets Sentry group by the error message and route tag
— you'll see every error and can search/filter by route, method and
environment, but grouping of "is this the same bug as that one" is coarser
than the SDK gives you. If that ever matters enough to be worth the build-time
cost, the SDK is a drop-in alternative behind the same `onRequestError` hook
in `instrumentation.ts` — nothing else in the app depends on the current
approach.

## 5. Testing it

```bash
curl -X POST https://your-staging-url/api/cron/does-not-exist \
  -H "Authorization: Bearer wrong-secret"
```

Not quite — that returns a handled 401, not an unhandled error. Easiest real
test: temporarily set `SENTRY_DSN` in a local `.env`, run `npm run serve`,
and trigger any genuinely unhandled error (e.g. a broken `await` in a page
you're editing); watch for the issue to appear in the Sentry project within a
few seconds. Remove the DSN from `.env` afterwards if you don't want local
dev errors landing in the project.
