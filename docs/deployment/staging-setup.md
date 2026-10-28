# Setting up staging (one-time, done by hand)

Everything here happens in the Neon console and the Vercel dashboard — there
is no API token in this repo for either, by design, so none of it can be
scripted from the codebase. Follow this once; after that, "push to `staging`,
test on the fixed URL, merge to `main`" is all you need (see `CLAUDE.md`).

Known facts this doc assumes (yours may differ if something changes):

- Vercel project `pirs`, deploying from GitHub `yadexo/pirs`, production
  domains `pirs.io` and `clinic.pirs.io`.
- Neon project with a `production` branch at `ep-frosty-cloud-zal3mzce`
  (region `eu-west-2`, database `neondb`).
- Stripe: still in test mode everywhere ("Pirs.io sandbox" keys), with a
  Connect webhook at `https://clinic.pirs.io/api/webhooks/stripe`.

## 1. Neon: create the staging branch

1. Neon console → your project → **Branches** → **New Branch**.
2. **Parent branch**: `production`. **Name**: `staging`.
3. Create it. This is an instant copy-on-write snapshot — it has production's
   exact schema (good) *and* production's current client data (not what you
   want for staging). Neon doesn't offer a "schema only" branch option, so the
   fix is to branch, then empty it:
4. Copy the new branch's **pooled** connection string (Neon shows "Pooled
   connection" vs "Direct connection" — pooled is what the app uses at
   runtime) and its **direct** connection string (what migrations need; same
   host without `-pooler`).
5. From the repo, empty the branch and put test data in:
   ```bash
   npm run stg:wipe
   # paste the branch's connection string when asked — direct, not pooled
   npm run stg:seed
   ```
   `stg:wipe` refuses to run if you ever paste the production string by
   mistake (it checks for `ep-frosty-cloud-zal3mzce`), so there's no way to
   point this at the wrong database.
6. Whenever you want staging's data reset back to a clean slate later, repeat
   step 5 — it's idempotent.

## 2. Vercel: a fixed URL for the `staging` branch

Vercel builds a new preview on every push to every branch, but the URL is
random per-deployment unless you pin a domain to the branch:

1. Buy/use a subdomain you control under `pirs.io` — e.g. `staging.pirs.io`.
   (Or reuse an existing one if you'd rather.)
2. Vercel project `pirs` → **Settings → Domains → Add**.
3. Enter `staging.pirs.io`. When asked which branch it should track, choose
   **Git Branch** and type `staging` (not "Production" — that's what makes
   this a staging-only domain instead of a second production domain).
4. Vercel shows you a CNAME (or A/ALIAS) record to add wherever `pirs.io`'s
   DNS is managed. Add it there.
5. Push anything to the `staging` branch and `https://staging.pirs.io` will
   serve that deployment once it builds — same URL every time, so it's safe
   to bookmark on your phone.

This single domain reaches all three surfaces by path
(`/login`, `/app/<clinic-slug>`, `/m/<id>`, `/agency`) — it won't automatically
get the short `pirs.io/<clinic>` or `clinic.pirs.io` auto-redirect behaviour,
because those hostnames are hardcoded in `lib/portal-hosts.ts`. That's fine
for testing the app itself; if you later want staging to mirror the exact
hostname-based routing too, add `staging.pirs.io` style entries there — it's
a few lines, not required for this setup.

## 3. Vercel: environment variables

Vercel scopes each environment variable to Production, Preview, and/or
Development. Set every row below as **Preview only** (uncheck Production and
Development) unless noted — Production's existing values are untouched.

Go to **Settings → Environment Variables**, and for each name below: **Add
New**, paste the value, tick only **Preview**, save.

| Variable | Preview value | Notes |
|---|---|---|
| `DATABASE_URL` | the staging branch's **pooled** connection string | from step 1 |
| `AUTH_SECRET` | a fresh secret — run `npx auth secret` locally and paste its output | never share with Production's |
| `PAYMENT_PROVIDER` | `stripe` | |
| `STRIPE_SECRET_KEY` | same "Pirs.io sandbox" test secret key Production uses today | fine to match for now — see step 4 for why this will need to split later |
| `STRIPE_PUBLISHABLE_KEY` | same test publishable key | |
| `STRIPE_WEBHOOK_SECRET` | **new** secret from a webhook endpoint you add in step 4 | must *not* reuse production's — a signing secret is per-endpoint |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | **new** secret from step 4 | same reason |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | a fresh pair — run `node -e "console.log(require('web-push').generateVAPIDKeys())"` locally | keeps a staging push subscription from ever being deliverable with production's identity. `WEB_PUSH_PUBLIC_KEY`/`WEB_PUSH_PRIVATE_KEY` are a separate, unimplemented integration point (see `.env.example`) — don't confuse them with these |
| `VAPID_SUBJECT` | `mailto:you@example.com` (anything reachable) | |
| `RESEND_API_KEY` | reuse Production's | one Resend account is fine |
| `EMAIL_FROM` | something that reads as staging, e.g. `staging@pirs.io` | so a test email is never mistaken for a real one |
| `STORAGE_PROVIDER` / `S3_*` | reuse Production's bucket and credentials | uploads from staging land in the same bucket; acceptable for test data, see note below if that bothers you |
| `APP_URL` | `https://staging.pirs.io` | |
| `CLIENT_APP_URL` | `https://staging.pirs.io` | same domain serves both here, unlike production's split |
| `APP_ENV` | `staging` | used only by `lib/observability.ts` error reports, if you set `ERROR_WEBHOOK_URL` too |
| `PLATFORM_FEE_PERCENT` | reuse Production's (or leave unset) | |
| `CRON_SECRET` | leave unset, or set your own | staging doesn't need the cron jobs production has (see step 5) |

Leave `MOCK_PAYMENTS_DECLINE` and `ERROR_WEBHOOK_URL` unset unless you
specifically want them. Don't set `AUTH_URL`/`NEXTAUTH_URL` — see the comment
in `.env.example`, it applies here too.

**S3 note**: if you'd rather staging uploads not land in the same bucket as
production's real clinic logos and product photos, create a second bucket (or
a separate prefix via a different `S3_BUCKET` value) and point staging's
`S3_*` vars at that instead. Not required to get staging working.

## 4. Stripe: a webhook endpoint for staging

Stripe's test mode already covers Preview (same test keys as Production), but
a webhook's signing secret is tied to its URL, so staging needs its own
endpoints even though the account is shared:

1. Stripe dashboard → make sure **test mode** is on (toggle, top right).
2. **Developers → Webhooks → Add endpoint**.
   - URL: `https://staging.pirs.io/api/webhooks/stripe`
   - Listen for the platform-account events your production endpoint listens
     for.
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET` (Preview-scoped, see
     the table above).
3. **Add endpoint** again, this time for **Connect** events on the same URL
   (Stripe makes you register platform and Connect events separately, same as
   production does per the comment in `.env.example`).
   - Copy that signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`.
4. When you eventually go live with real Stripe keys in Production, remember
   this is the moment `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` stop being
   shareable between Preview and Production — Preview should keep the test
   keys, Production switches to live ones. Nothing else above needs to change
   at that point.

## 5. Optional: cron jobs for staging

Production's two cron-job.org jobs (`/api/cron/marketing` every 5 minutes,
`/api/cron/memberships` hourly) exist to keep demo/real data moving over time.
Staging's seeded data doesn't need that upkeep — skip this unless you're
specifically testing cron behaviour. If you do want it, create the same two
jobs pointed at `https://staging.pirs.io/api/cron/<job>` with their own
`CRON_SECRET` (set that var in Vercel first).

## Everyday use after this is done once

```bash
git checkout staging && git pull
# ...make changes, commit...
git push                 # Vercel builds and deploys to staging.pirs.io
```

Open `https://staging.pirs.io` on your phone to test. When it's right:

```bash
git checkout main && git pull
git merge staging
git push                 # deploys to pirs.io / clinic.pirs.io
```

If a change needs a migration, run `npm run stg:migrate` against the staging
branch before merging, and `npm run prod:migrate` against production after
the merge deploys (same as today — this doesn't change).
