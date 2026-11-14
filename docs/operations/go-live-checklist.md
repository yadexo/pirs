# Go-live checklist — first real clinic

Written 14 November 2026 from a read-only pass over the code and docs at
commit `ad88061`. Target: live Stripe Connect, Vercel Pro, `login.deza.ai` /
`app.deza.ai` / `admin.deza.ai`. **The apex `deza.ai` and `www` are the
marketing site: nothing below attaches, routes or redirects them.**

Tick boxes are grouped by when. Findings from the code are in §A–§F; the
boxes refer to them by id.

---

## 1. Must do before go-live

### Code and configuration

- [ ] **T-1** Delete `REGISTRATION_CODE` and `REGISTRATION_SET_PASSWORD_DIRECTLY`
      from Vercel Production, then redeploy. Register pages 404; invitations keep working.
- [ ] **T-2** Confirm no `example.com` account or `Password123!` exists in production:
      `npm run prod:admins`, then query `User` for `%@example.com`.
- [ ] **T-3** Decide what happens to `testclinic2` in production: delete it from
      `/agency` before the first real clinic, or keep it and never show it in the finder (`publiclyListed` off).
- [ ] **T-4** Switch `CLAUDE.md` from "work on `main`, test on production" back to
      staging-first the day the first clinic signs. It says so itself; nobody will remember otherwise.
- [ ] **E-1** Every Production variable in §B marked **required** is set, and every
      one marked **differs** is not shared with Preview. Tick the table.
- [ ] **E-2** Rotate `AUTH_SECRET` and `CRON_SECRET` in Production (they have been
      used while the app was open to `example.com` accounts). Rotating `AUTH_SECRET` signs everyone out — do it last, announced.
- [ ] **E-3** `APP_URL=https://app.deza.ai` and `CLIENT_APP_URL=https://login.deza.ai`
      exactly — `https://`, no trailing slash. An `http://` value drops the secure cookie flags silently.
- [ ] **E-4** `PAYMENT_PROVIDER=stripe` in Production. Without it the mock provider is
      chosen even with keys present (`lib/providers/payments/index.ts:18`).

### Stripe (§C)

- [ ] **S-1** Live secret and publishable keys in Production only; Preview keeps the
      test keys (`docs/deployment/staging-setup.md` §4 step 4).
- [ ] **S-2** Create the **Connect** webhook endpoint in live mode with exactly the ten
      events in §C.2; secret → `STRIPE_CONNECT_WEBHOOK_SECRET`.
- [ ] **S-3** Create the **platform** endpoint in live mode (or leave
      `STRIPE_WEBHOOK_SECRET` unset — the route accepts either secret alone).
- [ ] **S-4** `PLATFORM_FEE_PERCENT` set to the agreed fee. Unset means **0%**: the
      platform earns nothing and nothing warns you (`lib/platform-fee.ts`).
- [ ] **S-5** Each connected clinic account: `npm run prod:stripe -- --clinic <slug>`
      reports `chargesEnabled` and `payoutsEnabled` true in **live** mode.
- [ ] **S-6** `npm run prod:apple-pay` once the live keys are in and the deploy is green.
      Registers `login.deza.ai` and `app.deza.ai` on every live connected account.
- [ ] **S-7** Stripe dashboard → Settings → Connect: branding, support email and the
      redirect URLs point at `app.deza.ai`, not `clinic.pirs.io`.
- [ ] **S-8** Run the €1 test in §C.4 end to end, including the refund, on a real card.

### Cron (§D)

- [ ] **D-1** Add `crons` to `vercel.json` for the four jobs with the schedules in
      §D.1, deploy, and confirm the first runs in Vercel → Cron.
- [ ] **D-2** Only then disable the cron-job.org jobs. The jobs are safe to run
      twice, so the overlap costs nothing; a gap is what to avoid.
- [ ] **D-3** `CRON_SECRET` set in Production. Vercel Cron sends it as
      `Authorization: Bearer <CRON_SECRET>` automatically when the variable exists.

### Operations (§E)

- [ ] **O-1** `SENTRY_DSN` set in Production (`docs/operations/sentry-setup.md`);
      a test error appears in Sentry.
- [ ] **O-2** Uptime monitor on `https://app.deza.ai/api/health` and
      `https://login.deza.ai/api/health`, 1-minute interval, alert to a phone.
- [ ] **O-3** Vercel → Settings → Billing: spend limit and alert set.
- [ ] **O-4** Neon → Project → Settings: compute autoscaling max set, and the plan's
      PITR window confirmed (7 days on Launch; `docs/operations/backup-restore.md`).
- [ ] **O-5** Restore drill done once on a branch, as in `backup-restore.md` §1–3,
      without promoting it. Note the date here: ________.
- [ ] **O-6** Incident contacts and the three plans in §E.4 written somewhere
      the on-call person can open without this repo.

### Legal and data (§F)

- [ ] **L-1** The clinic's terms and privacy text filled in App Builder → Settings →
      General for the first clinic. The client app shows only "data held by {clinic}" today — see F-1.
- [ ] **L-2** A data processing agreement signed with the clinic (you are the processor;
      the clinic is the controller of its clients' data).
- [ ] **L-3** Platform privacy notice and terms published on the marketing site, and
      linked from the clinic portal sign-in page (there is no link today — F-2).
- [ ] **L-4** Decide the retention period and what "delete my account" must erase;
      today it disables the login and clears consents only (F-4).

### Security review leftovers that block real client data

- [ ] **R-1** Check the production `REGISTRATION_CODE` was never the six-digit value
      that sat in `.env.example` — moot once T-1 is done.
- [ ] **R-2** `STRIPE_SECRET_KEY` present in Production (a missing key now refuses
      payments instead of pretending — `lib/stripe-payments.ts:41`).
- [ ] **R-3** Every owner and platform admin has two-factor confirmed:
      `npm run prod:admins` shows `2FA on` for all.

---

## 2. Within the first week

- [ ] **T-5** Remove the "Pirs.io sandbox" / test-mode wording from
      `docs/deployment/staging-setup.md:19-20,88` once live keys are in.
- [ ] **T-6** `lib/notifications-service.ts:53` sends campaign email to the literal
      `customer@example.com`. Nothing calls this module; delete it.
- [ ] **T-7** `.env.example:57,71`: replace `you@example.com` / `notifications@example.com`
      with the real `VAPID_SUBJECT` and `EMAIL_FROM` shape (`mailto:ops@deza.ai`, `Deza <notifications@deza.ai>`).
- [ ] **T-8** `README.md:152-168` documents `TWILIO_*` and `WEB_PUSH_*`; the code never
      reads them (`lib/providers/notifications/sms.ts`, `push.ts` are stubs). Say so or remove.
- [ ] **T-9** `README.md:297` says rate limiting is in-memory. It is in Postgres
      (`lib/rate-limit.ts`). Fix the line.
- [ ] **S-9** Stripe → Settings → Payouts: confirm each clinic's payout schedule and
      that your platform account's own payout bank is set.
- [ ] **S-10** Stripe → Settings → Notifications (or Radar alerts): email on
      `charge.dispute.created`, failed payouts and account deauthorisation.
- [ ] **S-11** Watch the live webhook endpoint's delivery log for a week; any
      non-2xx is a bug on our side (the route returns 500 and Stripe retries).
- [ ] **D-4** After a week on Vercel Cron, delete the cron-job.org account or jobs.
- [ ] **O-7** Set a Sentry alert rule: more than 5 errors in 10 minutes → email.
- [ ] **O-8** Check the Neon compute hours and Vercel function invocations after
      seven days against the limits set in O-3/O-4.
- [ ] **O-9** Confirm R2 bucket: no public listing, lifecycle rule decided, CORS
      limited to the three hosts (security review §5(e)).
- [ ] **L-5** Add a visible link to the clinic's own terms/privacy in the client app's
      legal sheet (F-1) and the platform's on the sign-in page (F-2). Small code change.
- [ ] **L-6** Add the "last admin" protection for two-factor resets and session
      invalidation on reset (security review A-11) before onboarding a second admin.
- [ ] **R-4** Security review batch 3: A-6 email verification for new clients,
      A-7/A-8 TOTP replay and secret encryption, A-10 one IP helper.

---

## 3. Later

- [ ] **T-10** Retire `pirs.io`: `docs/operations/domain-move.md` "Retiring pirs.io"
      (remove the Stripe endpoints, Apple Pay domains, Vercel domains, then the DNS).
- [ ] **T-11** `docs/design/pirs-v2-handoff/…:310` still says `{clinic}.pirs.io`. Design doc; update when next touched.
- [ ] **T-12** `lib/emails/preview-data.ts:27,54,66` builds preview links on
      `example.com`. Preview-only; harmless.
- [ ] **E-5** `LEGACY_ROOT_DOMAIN=pirs.io` in Production when ready to redirect the
      old addresses (`domain-move.md` step 9). Not before the Stripe and cron URLs are repointed.
- [ ] **D-5** Appointment reminders (`appointmentReminderHours`) and loyalty point
      expiry have settings but no job (`README.md:302-306`). Needs a fifth cron job.
- [ ] **D-6** `dataRetentionDays` on `TenantSettings` is stored and never acted on
      (`prisma/schema.prisma:206`). Needs a job plus the decision in L-4.
- [ ] **O-10** `vercel.json` pins `lhr1`; Neon is `eu-west-2`. Fine, but note it for
      any future region move: they must stay together.
- [ ] **S-12** Security review D-1: `sharp`, `zod`, `prisma` upgrades (`npm audit`
      still reports 8 high, none critical).
- [ ] **L-7** Client data export (there is none — F-5) and a documented erasure
      procedure per clinic. Needed before the first subject-access request, not before go-live.
- [ ] **L-8** Decide whether uploads (logos, product photos — never client data) need
      deletion; today nothing is ever deleted from R2 (`lib/providers/storage.ts`).

---

## A. Test-mode and demo leftovers

| Id | Where | What | Do |
|---|---|---|---|
| A-1 | `lib/providers/payments/index.ts:18` | Mock payments unless `PAYMENT_PROVIDER=stripe` **and** a key is set | E-4 |
| A-2 | `lib/stripe-payments.ts:41-53` | No key → "blocked" in production, mock elsewhere (fixed in review P-2) | Verify R-2 |
| A-3 | `lib/providers/payments/mock.ts:32` | `MOCK_PAYMENTS_DECLINE` read; ignored when `NODE_ENV=production` | Leave unset |
| A-4 | `app/m/[merchantId]/app-builder/settings/sections.tsx:1215` | "still runs in test mode" notice shown while `PAYMENT_PROVIDER≠stripe` | Disappears with E-4 |
| A-5 | `app/page.tsx:53` | Demo index with every seeded account; off when `VERCEL_ENV=production` | None — verify by opening `https://app.deza.ai/` → redirects to `/login` |
| A-6 | `README.md:97-105` | Seed accounts `platform-admin@example.com`, `clinic-admin@example.com`, `emma.johnson0@…`, one shared password | T-2 |
| A-7 | `prisma/seed.ts` | Seeds a demo tenant with `MOCK` payments | Never run against production (`stg:seed` only) |
| A-8 | `lib/notifications-service.ts:53` | Emails `customer@example.com`; module has no callers | T-6 |
| A-9 | `docs/deployment/staging-setup.md:19-20,88` | "Stripe still in test mode everywhere, Pirs.io sandbox keys" | T-5 |
| A-10 | `.env.example:57,71`, `staging-setup.md:93` | `example.com` placeholder addresses | T-7 |
| A-11 | `.env.example:204`→ now empty; `docs/operations/registration-code.md` | Temporary registration flags | T-1, R-1 |
| A-12 | `CLAUDE.md:45-60` | "Work on main, test on production with testclinic2" exception | T-3, T-4 |
| A-13 | `lib/legacy-domain.ts`, `docs/operations/domain-move.md` | `pirs.io` redirects, off until `LEGACY_ROOT_DOMAIN` is set | E-5, T-10 |
| A-14 | `lib/portal-hosts.ts:52-59` | Hosts derived from `NEXT_PUBLIC_ROOT_DOMAIN=deza.ai`; no hard-coded host elsewhere | None |
| A-15 | `middleware.ts` `isKnownPlatformHost` | Treats `deza.ai` and `www.deza.ai` as "ours" and would serve the app on them if a request ever arrived | Keep the apex and `www` **off** this Vercel project — that is the only guard |
| A-16 | `lib/apple-pay-domains.ts:42` | Domains come from `CLIENT_APP_URL`/`APP_URL`; `APPLE_PAY_DOMAINS` only adds extras | Clear `APPLE_PAY_DOMAINS` of `pirs.io` at T-10 |
| A-17 | `docs/design/pirs-v2-handoff/…:310` | `{clinic}.pirs.io` | T-11 |

No `sk_test`/`pk_test` string, sandbox key or live-mode check exists in code:
the app cannot tell a test key from a live one. **S-1 is a dashboard check,
not something the app will catch.**

---

## B. Environment variables (tick off in Vercel → Settings → Environment Variables)

"Missing" = what the app does without it. "Differs" = must not be shared
between Production and Preview. "Rotate" = change before go-live.

| Variable | Required in prod | Missing → | Differs | Rotate | ☐ |
|---|---|---|---|---|---|
| `DATABASE_URL` | yes | nothing starts | yes (Neon branch) | no | ☐ |
| `AUTH_SECRET` | yes | sign-in fails | yes | **yes** (E-2) | ☐ |
| `APP_URL` | yes, `https://app.deza.ai` | links fall back to localhost; cookies lose `Secure` | yes | no | ☐ |
| `CLIENT_APP_URL` | yes, `https://login.deza.ai` | QR/join/reset links use the long `/app/<slug>` form | yes (unset on Preview) | no | ☐ |
| `NEXT_PUBLIC_ROOT_DOMAIN` | yes, `deza.ai` | defaults to `deza.ai` anyway | no | no | ☐ |
| `NEXT_PUBLIC_CLIENT_HOST`, `CLINIC_HOST`, `ADMIN_HOST`, `NEXT_PUBLIC_EXTRA_CLIENT_HOSTS` | no | derived from the root domain | — | — | ☐ leave unset |
| `PAYMENT_PROVIDER` | yes, `stripe` | mock provider chosen (A-1) | no | no | ☐ |
| `STRIPE_SECRET_KEY` | yes, live | card payments refused | **yes** (live vs test) | n/a — new live key | ☐ |
| `STRIPE_PUBLISHABLE_KEY` | yes, live | Payment Element cannot load | **yes** | n/a | ☐ |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | yes | orders never marked paid | **yes** (per endpoint URL) | n/a | ☐ |
| `STRIPE_WEBHOOK_SECRET` | optional | platform-account events ignored | yes | n/a | ☐ |
| `PLATFORM_FEE_PERCENT` | yes | **0% fee, silently** | no | no | ☐ |
| `APPLE_PAY_DOMAINS` | no | only the two hosts registered | no | no | ☐ |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | yes for push | push "not set up" (501); app still works | share with Preview is **wrong** — a Preview push would reach real devices with real keys; use separate keys | no | ☐ |
| `PUSH_PROVIDER` | `webpush` | campaigns through the mock channel | no | no | ☐ |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | yes, `resend` | emails logged, never sent (welcome, reset, invites) | key: yes (scoped keys); `EMAIL_FROM` differs (`staging@`) | no | ☐ |
| `SMS_PROVIDER`, `TWILIO_*` | no | SMS is a stub either way | — | — | ☐ leave unset |
| `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`, `S3_ENDPOINT`, `S3_REGION` | yes, `s3` | uploads fail with "cannot write to disk" | bucket/prefix: recommended | key: yes if ever in a `.env` on a laptop | ☐ |
| `CRON_SECRET` | yes | `/api/cron/*` returns 503; nothing runs | yes | **yes** (E-2) | ☐ |
| `SENTRY_DSN` | strongly | errors only in Vercel logs | yes (two projects) | no | ☐ |
| `ERROR_WEBHOOK_URL` | no | — | — | — | ☐ leave unset |
| `APP_ENV` | no | `VERCEL_ENV` is used | — | — | ☐ leave unset |
| `MOCK_PAYMENTS_DECLINE` | **must be unset** | — | — | — | ☐ |
| `REGISTRATION_CODE`, `REGISTRATION_SET_PASSWORD_DIRECTLY` | **must be unset** | register pages 404 (correct) | — | — | ☐ (T-1) |
| `LEGACY_ROOT_DOMAIN` | not yet | no `pirs.io` redirects | — | — | ☐ unset until E-5 |
| `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | only for clinic domains | domain feature dormant | yes | project-scoped, expiring | ☐ |
| `BUILD_ID` | no | timestamp used | — | — | ☐ leave unset |
| `AUTH_URL` / `NEXTAUTH_URL` | **must be unset** | — | — | — | ☐ |

`VERCEL`, `VERCEL_ENV`, `NODE_ENV`, `NEXT_PUBLIC_BUILD_ID` are set by Vercel or the build; nothing to do.

---

## C. Stripe live checklist (Connect, direct charges)

### C.1 Keys
Live `sk_live_…` and `pk_live_…` in Production only. Preview keeps test keys and its own test-mode endpoints (`staging-setup.md` §4).

### C.2 Webhook endpoints — `https://app.deza.ai/api/webhooks/stripe`, live mode

**Endpoint 1 — "Events on connected accounts"** → `STRIPE_CONNECT_WEBHOOK_SECRET`. Select exactly (`lib/stripe-webhook.ts`):

- `account.updated`
- `account.application.deauthorized`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

**Endpoint 2 — "Events on your account"** → `STRIPE_WEBHOOK_SECRET`. The code handles the same ten; today nothing is billed on the platform account, so this endpoint can be created with the same list or skipped. If skipped, leave the variable unset.

The old `clinic.pirs.io` endpoints: leave enabled until T-10 (`domain-move.md` §4).

### C.3 Apple Pay
`npm run prod:apple-pay` after the live deploy is green; it fetches `/.well-known/apple-developer-merchantid-domain-association` from each host. Re-run is harmless. New clinics are registered by the `account.updated` webhook when charges become enabled.

### C.4 Fees, payouts, alerts
- `PLATFORM_FEE_PERCENT` → application fee on each direct charge (`lib/platform-fee.ts`); refunds return the fee (`lib/refunds.ts`, `REFUND_RETURNS_PLATFORM_FEE`).
- Clinic payouts: each connected account's own schedule (Stripe → Connect → Accounts).
- Alerts (S-10): disputes, failed payouts, deauthorisation. The app marks a disputed payment `DISPUTED` and the order with it but sends no alert to you.

### C.5 €1 real-payment test (S-8)
1. In the first clinic's App Builder, create a product "Live test" at €1.00, `publiclyListed` can stay off.
2. On an iPhone, as a real client account you control, buy it in the client app with a real card. Expect `/app/<slug>?order=…` to show "paid".
3. Stripe → connected account → Payments: the €1 charge with the application fee.
4. Vercel logs: `payment_intent.succeeded` returned 200. Portal → Shop → the order is `PAID`; `npm run prod:items` not needed.
5. Portal → Shop → the order → Refund in full. Expect the client email and `charge.refunded` 200; Stripe shows the fee returned.
6. Repeat once with Apple Pay on the iPhone card sheet (verifies S-6).
7. Archive the product.

---

## D. Cron

### D.1 Jobs (`lib/cron/jobs.ts`), all at `GET|POST https://app.deza.ai/api/cron/<job>`, header `Authorization: Bearer <CRON_SECRET>`

| Job | Does | Schedule | Safe to run twice |
|---|---|---|---|
| `cleanup` | expired tokens, rate-limit rows, stale impersonations, abandoned orders | hourly `0 * * * *` | yes |
| `marketing` | scheduled campaigns, birthdays; respects quiet hours | every 5 min `*/5 * * * *` | yes (claimed with a conditional update; birthday rows unique per year) |
| `memberships` | grace-period expiry, unpaid sign-ups, deferred price changes | hourly `30 * * * *` | yes (conditional updates) |
| `domains` | re-checks pending clinic domains with Vercel | hourly `15 * * * *` | yes |

### D.2 Moving from cron-job.org to Vercel Cron (Pro) without a gap or double runs

1. Add to `vercel.json`:
   ```json
   "crons": [
     { "path": "/api/cron/cleanup",     "schedule": "0 * * * *" },
     { "path": "/api/cron/marketing",   "schedule": "*/5 * * * *" },
     { "path": "/api/cron/memberships", "schedule": "30 * * * *" },
     { "path": "/api/cron/domains",     "schedule": "15 * * * *" }
   ]
   ```
   Vercel calls the path with `Authorization: Bearer $CRON_SECRET` when that variable is set — the route already checks exactly that.
2. Deploy. Vercel → Project → Cron shows the four jobs and their last run.
3. Leave cron-job.org running **until** each job has run once from Vercel (watch the logs). Both running for an hour is fine: every job is idempotent (D.1).
4. Disable the cron-job.org jobs. No gap, because step 3 overlapped them.
5. Preview deployments do not run `crons`; staging keeps its optional cron-job.org jobs (`staging-setup.md` §5) or none.

---

## E. Operations

### E.1 Monitor
- Sentry via `SENTRY_DSN` (`docs/operations/sentry-setup.md`): no SDK, errors only, no PII.
- Uptime on `/api/health` for `app.` and `login.`; it checks the database.
- Stripe webhook delivery log (S-11); Vercel → Cron run history (D-1).
- `npm run prod:admins` weekly: lockouts, 2FA status, duplicate admin addresses.

### E.2 Cost limits
- Vercel: spend management cap + alert (O-3). Image optimiser is closed, so no surprise there.
- Neon: autoscaling max compute and a scale-to-zero suspend; check compute hours weekly for the first month (O-4, O-8).
- R2: egress is free; set a storage alert at 10 GB.
- Resend: free tier is 3,000/month; the first clinic's welcome + reset + receipt mail fits; set a usage alert.

### E.3 Backups
Neon PITR only; no separate dump. `docs/operations/backup-restore.md` §1–4 is the restore procedure (branch, verify with `prod:status`, promote). Do O-5 once before go-live; repeat quarterly.

### E.4 Incident plans

**Payments failing** (clients see "can't start the payment" or orders stuck `PENDING`)
1. `curl https://app.deza.ai/api/health`; Vercel status page; Stripe status page.
2. Stripe → Developers → Webhooks → endpoint 1: any non-2xx in the last hour? → Vercel logs for `[stripe-webhook]`.
3. `npm run prod:stripe -- --clinic <slug>`: if `stale`, run with `--sync`.
4. If keys were rotated: check Production variables and redeploy.
5. Stuck `PENDING` orders release stock, points and credit after the abandoned-order window via `cleanup`; nothing to do by hand.

**A clinic reports wrong data**
1. Portal → App Builder → Settings → Audit log: who changed what, when.
2. If it is a client's balance: Clients → the client → credit/points history (every change has a reason and an actor).
3. If rows are gone: `backup-restore.md` — branch at the moment before, compare, copy the rows back by hand. Do **not** promote the branch for one clinic's rows.
4. Tell the clinic what happened and what was restored; audit-log the fix.

**A leaked key**
1. `STRIPE_SECRET_KEY`: Stripe → Developers → API keys → roll; set in Production; redeploy. Old key dies on roll.
2. `AUTH_SECRET`: generate new, set, redeploy — everyone is signed out; announce.
3. `CRON_SECRET`: new value in Production **and** in `vercel.json` consumers (none — Vercel reads the variable), redeploy.
4. `DATABASE_URL`: Neon → reset the role password; update Production; redeploy; check the staging branch did not share the role.
5. `S3_*`: R2 → delete the token, create a new one scoped to the bucket; update; redeploy.
6. `VERCEL_API_TOKEN`: revoke in Vercel account settings; create a project-scoped one with expiry.
7. Afterwards: `git log -p` for the value, Vercel deployment logs for the variable, and record the incident (date, key, exposure window, who was told).

---

## F. Legal and data — what the code does today

| Id | Topic | Today | Needed before real data |
|---|---|---|---|
| F-1 | Clinic terms / privacy | Clinics can type `termsContent`, `privacyContent`, `cancellationPolicy` in App Builder (`lib/actions/clinic-settings.ts:89-134`). The client app's legal sheet shows only "data held by {clinic}" (`profile-view.tsx:575-577`) and never renders those texts. | L-1 now; L-5 to show them |
| F-2 | Platform terms / privacy | No page and no link in portal, admin or client app | L-3 |
| F-3 | Cookie notice | Only strictly-necessary cookies: session, CSRF, locale, last clinic, impersonation. No trackers (grep found none). A banner is not required; a sentence in the privacy notice is | covered by L-3 |
| F-4 | Erasure | `clientDeleteAccountAction` (`lib/actions/client-app.ts:1570`): disables the login, clears consents, deletes push subscriptions, audit-logs it. Profile, orders, notes, items remain. Clinic deletion (`deleteMerchantAction`, `deleteTenantCompletely`) removes everything for a tenant. | L-4 decision; L-7 procedure |
| F-5 | Export | None for clients or clinics | L-7 |
| F-6 | Retention | `dataRetentionDays` stored, never applied | D-6 |
| F-7 | Where data lives | Neon `eu-west-2` (London), Vercel `lhr1`, R2 (uploads: logos and product photos only), Resend (email addresses in transit), Stripe (payment data; the app stores no card details), Sentry (errors, no PII) | List these in the DPA (L-2) and privacy notice |
| F-8 | Health-adjacent text | Client notes, redemption notes and appointment details are free text in the same database with no field-level protection (security review L-2) | Say so in the DPA; encryption is a later item |
