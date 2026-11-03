# Moving the platform to deza.ai

Everything outside the code, in order. The code side is already done and ships
off by default: `LEGACY_ROOT_DOMAIN` is empty until step 9, so deploying it
changes nothing on the old domain.

Three things to know before you start:

- **The apex `deza.ai` and `www.deza.ai` are not ours.** They serve a separate
  prospect-funnel website. This app does not route, rewrite or redirect on
  them, they are not client hosts, and they must not be attached to this
  Vercel project — see step 2.
- **`APP_URL` must be `https://` in production.** `auth.config.ts` derives the
  client app's `__Secure-`/`__Host-` cookie prefixes and their `secure` flag
  from it. An `http://`, empty or missing value silently drops them while
  sign-in still appears to work, and no test can catch it.
- **Every variable here takes effect on the next deployment, not on save.**
  Vercel binds environment variables to a deployment, and the `NEXT_PUBLIC_`
  ones are additionally baked into the built bundles. Set the variables, then
  redeploy.

The three surfaces and where they live:

| Surface | Host |
|---|---|
| Client app — short links, QR codes, the installed iPhone app, client sign-in | `login.deza.ai` |
| Clinic portal | `app.deza.ai` |
| Platform admin (`/agency`) | `admin.deza.ai` |
| Staging — long `/app/<clinic>` links, not a client host | `staging.deza.ai` |

## 1. DNS (GoDaddy)

Add records for `deza.ai` pointing at Vercel. Vercel shows the exact target
when you add each domain in step 2; it is normally:

| Type | Name | Value |
|---|---|---|
| CNAME | `login` | `cname.vercel-dns.com` |
| CNAME | `app` | `cname.vercel-dns.com` |
| CNAME | `admin` | `cname.vercel-dns.com` |
| CNAME | `staging` | `cname.vercel-dns.com` |

**Leave the `@` and `www` records alone.** They point at the marketing site.
Nothing in this document touches them.

**Leave every `pirs.io` record exactly as it is.** The old domain has to keep
resolving, both to serve the redirect and to keep answering the webhook and
cron paths.

## 2. Vercel → Settings → Domains

| Domain | Assign to |
|---|---|
| `login.deza.ai` | Production |
| `app.deza.ai` | Production |
| `admin.deza.ai` | Production |
| `staging.deza.ai` | **Git Branch → `staging`** — not Production. This is what makes it a staging domain rather than a second production one. |

**Remove `deza.ai` and `www.deza.ai` if they are attached.** While they are,
this app answers on them: the apex serves the three-portal landing page
instead of the marketing site, and `deza.ai/<clinic>` no longer serves the
client app either, because the apex is not a client host any more. Removing
them is part of this move, not of retirement.

Keep all the `pirs.io` domains attached to the project. Removing *those* is the
last step of retirement.

Wait for a certificate on all four before going further.

## 3. Environment variables

| Variable | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_ROOT_DOMAIN` | `deza.ai` | `deza.ai` |
| `APP_URL` | `https://app.deza.ai` | `https://staging.deza.ai` |
| `CLIENT_APP_URL` | `https://login.deza.ai` | **unset** — see below |
| `EMAIL_FROM` | `no-reply@deza.ai` | `staging@deza.ai` |
| `APPLE_PAY_DOMAINS` | `pirs.io,clinic.pirs.io` — **overlap only**, cleared at retirement | unset |
| `LEGACY_ROOT_DOMAIN` | `pirs.io` — **step 9, not now** | unset |
| `S3_PUBLIC_URL` | the R2 custom domain, once step 8 is done | unchanged |

**`CLIENT_APP_URL` must stay unset on Preview.** Setting it is what switches
link generation from the long `/app/<clinic>` form to the short `/<clinic>`
one, everywhere at once — QR codes, emails, push payloads. Staging is not a
client host, so `staging.deza.ai/<clinic>` does not resolve: a short link
minted there is dead, including on anything printed from staging.

Leave `NEXT_PUBLIC_CLIENT_HOST`, `CLINIC_HOST`, `ADMIN_HOST` and
`NEXT_PUBLIC_EXTRA_CLIENT_HOSTS` unset — each host is derived from
`NEXT_PUBLIC_ROOT_DOMAIN`. The first three exist for a host that does not
follow the `<name>.<root>` shape; the last is for a clinic's own client domain,
once there is one to add.

Then deploy (merge to `main`) and confirm the build is green.

## 4. Stripe

Add webhook endpoints at `https://app.deza.ai/api/webhooks/stripe` —
**twice**: once for platform-account events and once for Connect events, which
Stripe registers separately. Copy the two signing secrets into
`STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`, then redeploy.

**Leave the `clinic.pirs.io` endpoints enabled.** The route tries both secrets
on every request, so both URLs keep working, and the old one is still live
because `/api/webhooks/stripe` is exempt from the redirect. Disabling it early
drops events already in flight.

Update the Connect branding and redirect URLs in the Stripe dashboard too.

## 5. Apple Pay

Only once the new hosts resolve and the deployment is live — Stripe verifies a
domain by fetching `/.well-known/apple-developer-merchantid-domain-association`
from it, and will fail every registration otherwise. That path sits outside
the middleware matcher, so it is served on every host and follows no redirect.

The two domains that need it are `login.deza.ai` (where a client checks out)
and `app.deza.ai`; both are derived from `CLIENT_APP_URL` and `APP_URL`, so
step 3 is all the configuration there is. With `APPLE_PAY_DOMAINS` set as in
step 3, one run covers the old domains as well:

```bash
npm run prod:apple-pay
```

Idempotent — safe to re-run. It registers each domain on every connected
clinic account. Nothing else re-registers existing clinics: the
`account.updated` webhook only covers newly-enabled ones, so skipping this
step means Apple Pay silently stops working on the new domain.

Verify with a real card sheet on an iPhone at `login.deza.ai/<clinic>`.

## 6. Cron

Repoint the three cron-job.org jobs, same `CRON_SECRET`:

- `https://app.deza.ai/api/cron/cleanup` — hourly
- `https://app.deza.ai/api/cron/marketing` — every few minutes
- `https://app.deza.ai/api/cron/memberships` — hourly

No outage window and no ordering constraint: `/api/cron/*` is exempt from the
redirect, so the old URLs keep working until you change them.

## 7. Email (Resend)

Add and verify `deza.ai` as a sending domain, with the SPF/DKIM/DMARC records
from `docs/operations/email-setup.md`. The mail domain is the apex — that is
the one record set this move shares with the marketing site, and it is
deliberate: mail is sent *from* `deza.ai`, nothing is served on it.
`EMAIL_FROM` is already set in step 3; redeploy and send one test from the
clinic portal.

## 8. Uploads (R2)

Add `uploads.deza.ai` as a custom domain on the R2 bucket, point the DNS at
it, then set `S3_PUBLIC_URL` to `https://uploads.deza.ai` and redeploy.

Verify with `npm run prod:storage-check` — it uploads a real object and reads
it back through `S3_PUBLIC_URL`, which is the only thing that catches a public
URL that does not match the bucket.

Already-stored images keep their old absolute URLs in the database. They keep
working as long as the old public URL does, so retire that last.

## 9. Turn the redirect on

First, **check the redirect table against the live `pirs.io` DNS**. The table
in `lib/legacy-domain.ts` lists the old apex, `www`, `login`, `clinic`,
`admin` and `staging`. Any other old subdomain that still resolves gets no
redirect at all — it keeps serving the app, which is the deliberate choice: a
308 is cached indefinitely, so guessing a target that turns out not to be
attached would pin visitors to a certificate error with no way back. If DNS
shows a subdomain worth redirecting, add it to the table first.

Then set `LEGACY_ROOT_DOMAIN=pirs.io` in Production and **redeploy**.

The redirect is a **308, which browsers cache indefinitely**. If you want a
cautious first pass, change the status in `middleware.ts` to 307 for a day,
confirm every shape below, then land 308. With no real clinics yet, going
straight to 308 is defensible.

## 10. Verify

Against production, in a fresh private window per host:

- `app.deza.ai/` → the clinic login
- `admin.deza.ai/` → the admin login
- `login.deza.ai/` → "Find your clinic"
- `login.deza.ai/<clinic>` → the client app, short address still in the bar
- `login.deza.ai/app/<clinic>` → 308 to `/<clinic>`
- `deza.ai/` and `www.deza.ai/` → **the marketing site**, untouched by this app
- `deza.ai/<clinic>` → whatever the marketing site does with an unknown path.
  It must *not* be the client app, and must not redirect anywhere we own.
- `staging.deza.ai/app/<clinic>` → the client app on the long form;
  `staging.deza.ai/<clinic>` → **404**. Staging is not a client host.
- `pirs.io/<clinic>` → 308 to `https://login.deza.ai/<clinic>`
- `www.pirs.io/<clinic>` → 308 to `https://login.deza.ai/<clinic>` —
  **never** to `https://deza.ai/<clinic>`, which is the marketing site
- `clinic.pirs.io/login` and `login.pirs.io/login` → 308 to
  `https://app.deza.ai/login`
- `curl -sS -o /dev/null -w '%{http_code}' https://pirs.io/api/cron/cleanup`
  → **401**, never a 3xx
- `curl -sS -X POST -o /dev/null -w '%{http_code}' https://pirs.io/api/webhooks/stripe`
  → **400**, never a 3xx
- Sign in at `login.deza.ai/<clinic>` and confirm in devtools that the cookie
  is named `__Secure-client-app.session-token`. If the `__Secure-` prefix is
  missing, `APP_URL` is wrong — see the note at the top.
- Add the app to an iPhone home screen from `login.deza.ai/<clinic>`, open it,
  and tap through to the Shop tab: it must stay full screen, with no address
  bar. An address bar means the manifest scope is wrong for the host.
- Scan a clinic's QR from the clinic portal and confirm it opens the clinic.
- Use "forgot password" inside a clinic's client app and confirm the emailed
  link is on `login.deza.ai`, not `app.deza.ai`.

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
it again from `login.deza.ai/<clinic>`. The installed app is pinned to the old
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
