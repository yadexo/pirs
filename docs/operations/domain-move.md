# Moving the platform to deza.ai

Everything outside the code, in order. The code side is already done and ships
off by default: `LEGACY_ROOT_DOMAIN` is empty until step 9, so deploying it
changes nothing.

Two things to know before you start:

- **`APP_URL` must be `https://` in production.** `auth.config.ts` derives the
  client app's `__Secure-`/`__Host-` cookie prefixes and their `secure` flag
  from it. An `http://`, empty or missing value silently drops them while
  sign-in still appears to work, and no test can catch it.
- **Every variable here takes effect on the next deployment, not on save.**
  Vercel binds environment variables to a deployment, and
  `NEXT_PUBLIC_ROOT_DOMAIN` is additionally baked into the built bundles. Set
  the variables, then redeploy.

## 1. DNS (GoDaddy)

Add records for `deza.ai` pointing at Vercel. Vercel shows the exact target
when you add each domain in step 2; it is normally:

| Type | Name | Value |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |
| CNAME | `clinic` | `cname.vercel-dns.com` |
| CNAME | `admin` | `cname.vercel-dns.com` |
| CNAME | `login` | `cname.vercel-dns.com` |
| CNAME | `staging` | `cname.vercel-dns.com` |

**Leave every `pirs.io` record exactly as it is.** The old domain has to keep
resolving, both to serve the redirect and to keep answering the webhook and
cron paths.

## 2. Vercel → Settings → Domains

| Domain | Assign to |
|---|---|
| `deza.ai` | Production |
| `www.deza.ai` | Production |
| `clinic.deza.ai` | Production |
| `admin.deza.ai` | Production |
| `staging.deza.ai` | **Git Branch → `staging`** — not Production. This is what makes it a staging domain rather than a second production one. |
| `login.deza.ai` | **Redirect to `clinic.deza.ai`** — the app does not route on it, exactly as `login.pirs.io` works today. |

Keep all the `pirs.io` domains attached to the project. Removing them is the
last step of retirement, not part of the move.

Wait for a certificate on all six before going further.

## 3. Environment variables

| Variable | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_ROOT_DOMAIN` | `deza.ai` | `deza.ai` |
| `APP_URL` | `https://clinic.deza.ai` | `https://staging.deza.ai` |
| `CLIENT_APP_URL` | `https://deza.ai` | `https://staging.deza.ai` |
| `EMAIL_FROM` | `no-reply@deza.ai` | `staging@deza.ai` |
| `APPLE_PAY_DOMAINS` | `pirs.io,clinic.pirs.io` — **overlap only**, cleared at retirement | unset |
| `LEGACY_ROOT_DOMAIN` | `pirs.io` — **step 9, not now** | unset |
| `S3_PUBLIC_URL` | the R2 custom domain, once step 8 is done | unchanged |

Leave `CLINIC_HOST`, `ADMIN_HOST`, `LOGIN_HOST` and
`NEXT_PUBLIC_EXTRA_CLIENT_HOSTS` unset — each host is derived from
`NEXT_PUBLIC_ROOT_DOMAIN`. They exist for a host that does not follow the
`<name>.<root>` shape.

Then deploy (merge to `main`) and confirm the build is green.

## 4. Stripe

Add webhook endpoints at `https://clinic.deza.ai/api/webhooks/stripe` —
**twice**: once for platform-account events and once for Connect events, which
Stripe registers separately. Copy the two signing secrets into
`STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`, then redeploy.

**Leave the `clinic.pirs.io` endpoints enabled.** The route tries both secrets
on every request, so both URLs keep working, and the old one is still live
because `/api/webhooks/stripe` is exempt from the redirect. Disabling it early
drops events already in flight.

Update the Connect branding and redirect URLs in the Stripe dashboard too.

## 5. Apple Pay

Only once `deza.ai` resolves and the deployment is live — Stripe verifies a
domain by fetching `/.well-known/apple-developer-merchantid-domain-association`
from it, and will fail every registration otherwise. That path sits outside
the middleware matcher, so it is served on both domains and follows no
redirect.

With `APPLE_PAY_DOMAINS` set as in step 3 (so one run covers old and new):

```bash
npm run prod:apple-pay
```

Idempotent — safe to re-run. It registers each domain on every connected
clinic account. Nothing else re-registers existing clinics: the
`account.updated` webhook only covers newly-enabled ones, so skipping this
step means Apple Pay silently stops working on the new domain.

Verify with a real card sheet on an iPhone at `deza.ai/<clinic>`.

## 6. Cron

Repoint the three cron-job.org jobs, same `CRON_SECRET`:

- `https://clinic.deza.ai/api/cron/cleanup` — hourly
- `https://clinic.deza.ai/api/cron/marketing` — every few minutes
- `https://clinic.deza.ai/api/cron/memberships` — hourly

No outage window and no ordering constraint: `/api/cron/*` is exempt from the
redirect, so the old URLs keep working until you change them.

## 7. Email (Resend)

Add and verify `deza.ai` as a sending domain, with the SPF/DKIM/DMARC records
from `docs/operations/email-setup.md`. `EMAIL_FROM` is already set in step 3;
redeploy and send one test from the clinic portal.

## 8. Uploads (R2)

Add `uploads.deza.ai` as a custom domain on the R2 bucket, point the DNS at
it, then set `S3_PUBLIC_URL` to `https://uploads.deza.ai` and redeploy.

Verify with `npm run prod:storage-check` — it uploads a real object and reads
it back through `S3_PUBLIC_URL`, which is the only thing that catches a public
URL that does not match the bucket.

Already-stored images keep their old absolute URLs in the database. They keep
working as long as the old public URL does, so retire that last.

## 9. Turn the redirect on

Set `LEGACY_ROOT_DOMAIN=pirs.io` in Production, then **redeploy**.

The redirect is a **308, which browsers cache indefinitely**. If you want a
cautious first pass, change the status in `middleware.ts` to 307 for a day,
confirm every shape below, then land 308. With no real clinics yet, going
straight to 308 is defensible.

## 10. Verify

Against production, in a fresh private window per host:

- `clinic.deza.ai/` → the clinic login
- `admin.deza.ai/` → the admin login
- `deza.ai/` → "Find your clinic"
- `deza.ai/<clinic>` → the client app, short address still in the bar
- `deza.ai/app/<clinic>` → 308 to `/<clinic>`
- `pirs.io/<clinic>` → 308 to `https://deza.ai/<clinic>`
- `clinic.pirs.io/login` → 308 to `https://clinic.deza.ai/login`
- `curl -sS -o /dev/null -w '%{http_code}' https://pirs.io/api/cron/cleanup`
  → **401**, never a 3xx
- `curl -sS -X POST -o /dev/null -w '%{http_code}' https://pirs.io/api/webhooks/stripe`
  → **400**, never a 3xx
- Sign in at `deza.ai/<clinic>` and confirm in devtools that the cookie is
  named `__Secure-client-app.session-token`. If the `__Secure-` prefix is
  missing, `APP_URL` is wrong — see the note at the top.
- Scan a clinic's QR from the clinic portal and confirm it opens the clinic.

## 11. Check the database

Code fallbacks are invisible once an `AgencySettings` row exists, and
`prisma/seed.ts` never creates one — so the live row decides what the platform
calls itself. Open `/agency/white-label` and check `name` reads **Deza**, and
that `customDomain` (display text only, nothing routes on it) does not still
say pirs.io. Change it through that form, not with SQL.

The migration shipped with this change only alters the column's *default*,
which does not touch rows that already exist.

## 12. Tell users

Everyone has to sign in again: every cookie is host-only, so a session on the
old domain is never sent to the new one. There is no way around this — a
server on pirs.io cannot set a cookie for deza.ai.

Clients with the app installed on a phone must **delete the old icon** and add
it again from `deza.ai/<clinic>`. The installed app is pinned to the old
origin and cannot be migrated; worse, its service worker will not follow a
cross-origin redirect, so it keeps serving its cached copy and looks like it
is working while showing stale content.

Clients who had notifications on must re-enable them after reinstalling — push
subscriptions are minted per origin. Anyone who reinstalls *before* deleting
the old icon gets **double notifications** until the push service starts
rejecting the old endpoint and we prune it automatically; deleting the old
icon stops it at once. **Do not rotate the VAPID keys** — they are
domain-independent, and rotating them breaks both domains and loses the
automatic pruning.

Clinics should reprint QR posters before pirs.io retires. Old posters keep
working via the redirect until then.

Nobody re-enrols two-factor: existing authenticator entries keep working, and
simply still read the old issuer name.

## Rolling back

Clear `LEGACY_ROOT_DOMAIN` and redeploy: the old domain serves the app again
instead of redirecting. Everything else in this document is additive — the
pirs.io DNS, Vercel domains, Stripe endpoints and Apple Pay registrations are
all still in place, so nothing else has to be undone.

The one thing a rollback does not undo is a 308 already cached in a visitor's
browser. That is the argument for the 307-first pass in step 9.

## Retiring pirs.io

Only once the redirect has run long enough that the old addresses are out of
circulation — printed posters are the slowest.

1. Remove the `clinic.pirs.io` endpoints in Stripe.
2. Clear `APPLE_PAY_DOMAINS`, redeploy, and re-run `npm run prod:apple-pay`.
3. Clear `LEGACY_ROOT_DOMAIN` and redeploy.
4. Remove the `pirs.io` domains from the Vercel project.
5. Retire the old R2 public URL once no stored image still points at it.
6. Drop the DNS records last.
