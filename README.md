# Clinic Engagement Platform

A white-label, multi-tenant sales, loyalty, membership, and customer-engagement platform for clinics and practices in general (not tied to any single specialty). Each tenant gets its own branded customer app and a full business-administration dashboard; a platform-admin layer manages tenants across the whole system.

## Product overview

Three portals, one codebase:

- **Customer app** (`/[tenant]/...`, mobile-first) — browse services, products, packages, and promotions; book appointments; join memberships; earn and redeem loyalty points; message the clinic; manage profile and notification preferences.
- **Business admin dashboard** (`/admin/...`, desktop-first but responsive) — manage the catalogue, customers, leads, appointments, memberships, loyalty, promotions, notification campaigns, conversations, staff and permissions, locations, branding, business settings, analytics, and the audit log.
- **Platform admin** (`/platform/...`) — create and suspend tenants, view platform-wide usage, and manage subscription status per tenant.

Demo/seeded data is clearly a fixture for a fictional business ("Riverside Wellness Clinic") — swap it out via `prisma/seed.ts` for a real deployment.

## Architecture

- **Framework**: Next.js 15 (App Router), TypeScript, Server Actions for almost all mutations, a handful of Route Handlers for webhooks/uploads/NextAuth.
- **Multi-tenancy**: every tenant-owned table carries a `tenantId` column. All staff/customer requests go through `getTenantDb(tenantId)` (`lib/tenant-db.ts`), a Prisma Client Extension that **automatically injects `tenantId` into every `where`/`create`** for tenant-scoped models — so a missing manual filter can't leak another tenant's data. Only platform-admin code paths use the raw, unscoped client (`lib/db.ts`), and always explicitly by tenant id when looking at a single tenant. Tenant identity for staff/customers comes only from their authenticated session, never from the URL.
- **Auth**: Auth.js (NextAuth v5) with a Credentials provider and bcrypt password hashing, JWT sessions. Three login surfaces share one `User` table (`role: PLATFORM_ADMIN | TENANT_ADMIN | STAFF | CUSTOMER`): customers sign in at `/[tenant]/login`, staff at `/admin/login` (workspace slug + email + password), platform admins at `/platform/login`.
- **RBAC**: `TENANT_ADMIN` has implicit full access. `STAFF` permissions come from a tenant-scoped, admin-editable `Role` → `RolePermission` → `Permission` model (`/admin/staff/roles`), checked server-side via `requirePermission()`/`requireRole()` (`lib/rbac.ts`) in every server action and route handler.
- **Payments**: a `PaymentProvider` interface (`lib/providers/payments`) with a `MockPaymentProvider` (default — deterministic, no card data ever stored) and a `StripePaymentProvider`, switched via `PAYMENT_PROVIDER`. Checkout math (tax, promo/loyalty discounts, account credit) is pure and unit-tested in `lib/checkout-calculations.ts`.
- **Notifications**: per-channel `ChannelProvider` interfaces (`lib/providers/notifications`) — mock by default, with documented integration points for Resend (email), Twilio (SMS), and Web Push. Campaigns are queued through `NotificationCampaign`/`NotificationDelivery` regardless of provider.
- **Messaging**: `Conversation`/`Message` models support in-app messaging today, with the data model and provider pattern ready for email/SMS/social channels later.
- **File storage**: local disk (`/public/uploads`) by default via a `StorageProvider` interface, swappable for S3-compatible storage.
- **Money**: always stored as integer minor units (cents) — never floats.

## Technology stack

Next.js 15 · React 19 · TypeScript · Tailwind CSS · PostgreSQL · Prisma ORM · Auth.js v5 · Zod · Vitest.

## Local setup

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ (a local install or Docker both work — see below)

### Quick start (recommended)

```bash
npm install
npm run setup     # starts Docker + PostgreSQL, migrates, seeds demo data
npm run dev       # → http://localhost:3000
```

`npm run setup` is idempotent and handles everything: it starts Docker Desktop if it isn't running, brings up the database container and waits for it to be healthy, creates `.env` with a fresh `AUTH_SECRET` if missing, applies migrations to both the dev and test databases, and seeds demo data only if the database is empty. Run it any time — after a clone, after a reboot, or whenever something looks off.

The manual steps below explain what it does, if you'd rather run them yourself or use your own PostgreSQL.

### 1. Install dependencies

```bash
npm install
```

### 2. Database

**Recommended — Docker Compose** (creates both the dev and test databases for you):

```bash
docker compose up -d
```

This maps the container's PostgreSQL to **host port 5433**, deliberately avoiding a clash with any PostgreSQL already installed natively on 5432. `.env.example` already points at 5433.

**Alternative — your own PostgreSQL.** Create the role and databases yourself:

```sql
CREATE ROLE app_user WITH LOGIN PASSWORD 'app_password' CREATEDB;
CREATE DATABASE app_dev OWNER app_user;
CREATE DATABASE app_test OWNER app_user;
```

Then change the port in `DATABASE_URL` (in both `.env` and `.env.test`) from `5433` to your instance's port, usually `5432`.

### 3. Environment variables

```bash
cp .env.example .env
```

Generate a real `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

See [Environment variables](#environment-variables) below for the full list.

### 4. Migrate and seed

```bash
npm run prisma:migrate
npm run seed
```

Seed output prints the demo login credentials. Everything uses the password `Password123!`:

Start at `/`, which links to all three portals. Admin and Clinic share one sign-in at `/login`; the account's role decides where it lands.

| Portal | Where | Email |
| --- | --- | --- |
| Admin (agency) | `/login` → `/agency` | `platform-admin@example.com` |
| Clinic | `/login` → `/m/:merchantId` | `clinic-admin@example.com` (staff: `alex.kim@example.com`) |
| Client | `/app/riverside-wellness` | `emma.johnson0@example.com` (or any other seeded client) |

### 5. Run the dev server

```bash
npm run dev
```

Visit `http://localhost:3000`.

## Restarting

After a machine reboot (or any time Docker was shut down):

```bash
npm run setup   # brings Docker + the database back, no-ops on anything already fine
npm run dev
```

The database container is declared `restart: unless-stopped`, so it comes back on its own once Docker Desktop is running — `npm run setup` mainly covers the case where Docker itself isn't up yet. Your data lives in a named Docker volume and survives container restarts, `docker compose down`, and reboots.

| Command | What it does |
| --- | --- |
| `npm run setup` | Full idempotent bootstrap — start Docker, database, migrate, seed if empty |
| `npm run setup:reset` | **Destructive.** Wipes the database volume and reseeds from scratch |
| `npm run db:up` / `db:down` | Start / stop just the database container |
| `npm run db:logs` | Tail PostgreSQL logs |
| `npm run dev:clean` | Clear the `.next` cache, then start the dev server |

### Troubleshooting

**`next dev` fails with `EINVAL: invalid argument, readlink … .next/app-build-manifest.json`**
This project lives under OneDrive, whose sync filter can corrupt Next.js's build cache. Fix:

```bash
npm run dev:clean
```

**`failed to connect to the docker API … dockerDesktopLinuxEngine`**
Docker Desktop isn't running. `npm run setup` will start it and wait, or start it yourself and re-run.

**Port 5433 vs 5432**
The container publishes on **5433** on purpose, so it never collides with a PostgreSQL installed natively on 5432. If you'd rather use 5432, change the port mapping in `docker-compose.yml` and the `DATABASE_URL` in both `.env` and `.env.test`.

**Tests fail with "table does not exist"**
The test database needs its own migrations: `npm run test:setup`.

## Environment variables

All variables are documented in `.env.example`. Summary:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | Auth.js session signing (leave `NEXTAUTH_URL` unset; the request host is used) |
| `PAYMENT_PROVIDER` | `mock` (default) or `stripe` |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | Required only when `PAYMENT_PROVIDER=stripe` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret of the webhook endpoint listening to **connected account** events (clients' payments). Needed to take money |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint listening to **platform account** events (billing the clinics) |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | `mock` (default) or `resend` |
| `SMS_PROVIDER`, `TWILIO_*` | `mock` (default) or `twilio` |
| `PUSH_PROVIDER`, `WEB_PUSH_*` | `mock` (default) or `webpush` |
| `STORAGE_PROVIDER`, `S3_*` | `local` (default, writes to `/public/uploads`) or `s3` |
| `APP_URL` | Used for building absolute links (e.g. Stripe billing portal returns) |

## Database commands

```bash
npm run prisma:generate   # regenerate the Prisma client after a schema change
npm run prisma:migrate    # create/apply a migration in development
npm run prisma:deploy     # apply migrations in production (no schema drift prompts)
npm run prisma:studio     # browse the database visually
npm run seed               # (re)seed demo data — safe to re-run, replaces the demo tenant
```

### One-off tasks against production

`scripts/prod.ps1` (PowerShell) asks once for the production connection string,
shows which database it is about to touch, waits for confirmation, and clears
the connection string afterwards — nothing is written to disk, so there is no
`.env.production.local` to remember to delete.

```bash
npm run prod:status                                  # read-only: what is pending?
npm run prod:migrate                                 # apply pending migrations
npm run prod:admin -- --email you@example.com        # create the first platform admin
npm run prod:reset-admin -- --email you@example.com  # reset a platform admin password
npm run prod:apple-pay                               # register Apple Pay domains on connected accounts
npm run prod:items -- --dry-run                       # backfill redeemable items (counts first)
npm run prod:client -- --clinic testclinic --email client@example.com
```

Paste Neon's **direct** connection string (the host without `-pooler`): a
migration takes a lock that a pooled connection can fail on.

## Development commands

```bash
npm run dev         # start the dev server
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run build        # production build
npm run start         # run the production build
```

## Test commands

Tests run against a **separate** database (`app_test` by default, configured in `.env.test`) so they never touch your dev data.

```bash
npm run test:setup   # one-time: apply migrations to the test database
npm test             # run once
npm run test:watch   # watch mode
```

Re-run `npm run test:setup` after any schema change.

Test coverage includes: password hashing, RBAC role/permission checks, tenant isolation (cross-tenant reads/writes/deletes are structurally blocked), checkout math (subtotal/tax/discount/credit interactions), the mock payment provider, promotion eligibility (expiry, usage limits, per-customer limits, item-scoped eligibility), loyalty point earning and redemption, manual credit/point adjustments (reason required, auditable), the membership join/pause/resume/cancel state machine, appointment availability (working hours, existing bookings, blocked time), and payment/refund state transitions (including over-refund rejection).

Some tests exercise real server actions with `@/lib/rbac`'s session-dependent functions mocked to a fixed test user/tenant, so business logic runs for real against Postgres without needing a live HTTP session.

## Production build

```bash
npm run build
npm run start
```

Set `NODE_ENV=production` and point `DATABASE_URL` at your production database; run `npm run prisma:deploy` as part of your deploy pipeline before starting the app.

## Payment provider setup

Default is `PAYMENT_PROVIDER=mock` — checkout and membership billing work end-to-end with no external account. Set `MOCK_PAYMENTS_DECLINE=1` to make every mock payment fail, which is how the failed-payment path is exercised; it is ignored when `NODE_ENV=production`. No card data is ever collected or stored by this codebase either way.

To enable Stripe:

1. Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`.
2. Register **two** webhook endpoints in Stripe, both pointing at `POST /api/webhooks/stripe`. Stripe treats "events on your account" and "events on connected accounts" as separate endpoints and will not deliver both to one, and it signs each with that endpoint's own secret. The route tries both secrets and refuses a request only when neither verifies.

   | Endpoint | Listen to | Events | Secret goes in |
   | --- | --- | --- | --- |
   | Connected accounts | Events on connected accounts | `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `account.updated`, `account.application.deauthorized`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
   | Platform account | Events on your account | the platform's own billing of its clinics, when you set that up | `STRIPE_WEBHOOK_SECRET` |

   Clients' memberships are subscriptions on the clinics' own accounts, so `invoice.paid` and `invoice.payment_failed` belong on the **connected accounts** endpoint — that is what activates a membership and what puts one past due.

   Clients' payments are direct charges on the clinic's own connected account, so the Connect endpoint is the one that marks orders paid. An instance that only takes client payments can set just `STRIPE_CONNECT_WEBHOOK_SECRET`; one that only bills clinics can set just `STRIPE_WEBHOOK_SECRET`. Each secret is issued per endpoint, so local and production values differ, and `stripe listen --forward-connect-to` issues its own again.
3. The customer-facing checkout UI collects payment via Stripe Elements/Checkout on your front end — only a token/PaymentIntent id ever reaches this codebase.

## Memberships

A membership is a Stripe subscription **on the clinic's own connected account**: the clinic's customer, the clinic's price, the clinic's invoices, visible in the clinic's own Stripe dashboard. The platform's cut rides on each invoice as an `application_fee_percent`.

- **Joining** creates the membership `PENDING` and the subscription with its first invoice incomplete. The client confirms that invoice in the Payment Element. Nothing is a membership until it is paid: no benefits and no included credit while it is `PENDING`.
- **`invoice.paid` is the only thing that activates a period.** It sets the period dates, clears any outstanding failures, and grants the plan's included credit — once per invoice, so a repeated delivery cannot grant it twice, and again for each new period.
- **The fee per clinic** is set by the agency on /agency ("Membership fee"), stored on `Tenant.membershipFeePercent`. Blank means the clinic pays the same percentage as its other sales (`PLATFORM_FEE_PERCENT`); `0` means the platform takes nothing. It is never editable by the clinic.
- **A failed payment** sets `PAST_DUE` and stamps `pastDueSince`. Benefits continue for seven days (`PAST_DUE_GRACE_MS` in `lib/membership-status.ts`) while Stripe retries the card; the clock starts at the first failure and is not restarted by later ones. The `memberships` cron job then suspends it. A payment that succeeds at any point brings it straight back.
- **A clinic that cannot take payments** shows no membership plans at all — the tab is not rendered, and joining is refused server-side as well.

### What a member gets

- **The plan's price at the till.** `serviceDiscountPercent` and `productDiscountPercent` become discount candidates in `lib/discounts.ts`, scoped to treatments and to products respectively, so the member price in the shop and the one charged at checkout come from one calculation.
- **Whichever discount is larger, never both.** A plan competes with the automatic promotions in `bestDiscount`; the client gets the single best one. A membership discount has no promotion behind it, so no `PromotionRedemption` is written and no usage limit applies — it is a benefit of paying for the plan, available every time.
- **Benefits follow the status, including the grace period.** A `PENDING` membership gives nothing; a `PAST_DUE` one keeps the member price until the grace period runs out; `SUSPENDED` and `CANCELLED` give nothing. One helper, `membershipGivesBenefits`, decides it everywhere.
- **The included credit is money.** It lands in `CustomerProfile.accountCreditBalanceCents` — the balance the client app already showed them — with a row in the credit ledger, granted per paid period. `CustomerMembership.creditBalanceCents` keeps the running total that plan has granted, for the clinic's billing history.

### Account credit at checkout

`lib/account-credit.ts` is the only place a balance moves: one conditional UPDATE plus a ledger row, like the loyalty ledger, so two checkouts cannot spend the same credit.

- The cart sends `useCredit` as a yes/no. **How much** is read from the balance on the server and capped at the bill, so a browser cannot ask for credit the client does not have.
- Credit comes off **after** tax, because it is money rather than a discount: the tax was on what they bought, however they paid for it.
- It is taken before the card is charged and given back if the payment fails, exactly like reserved loyalty points and stock.
- When credit covers the whole bill there is no card step: the order is settled with a `Payment` row whose provider is `ACCOUNT_CREDIT`, and refunding that payment puts the credit back rather than touching a bank.

## Notification provider architecture

`lib/providers/notifications/{email,sms,push}.ts` are documented, ready-to-implement integration points (Resend, Twilio, Web Push respectively) — each currently throws with instructions if selected without being implemented. Until then, `EMAIL_PROVIDER`/`SMS_PROVIDER`/`PUSH_PROVIDER=mock` (the default) logs the send and records a normal `NotificationDelivery` row, so campaign creation, targeting, and delivery-status UI all work today without any external account.

## Known limitations

- **Availability engine** works in local server time without per-tenant timezone/DST-aware slot math — acceptable for a single-timezone clinic, worth revisiting for multi-region tenants.
- **Rate limiting** (`lib/rate-limit.ts`) is in-memory and per-process — fine for one instance, needs a shared store (e.g. Redis) behind a load balancer.
- **Platform-admin email uniqueness** is enforced at the application layer, not a DB constraint (the `User` table's unique index is `[tenantId, email]`, and platform admins have `tenantId = null`) — acceptable given platform admins are few and created only by other platform admins.
- **Stripe integration** is implemented against the SDK but not exercised against a live Stripe account in this environment — verify against a real test-mode account before going live.
- **Data retention** (`TenantSettings.dataRetentionDays`) is stored and surfaced in settings but no background job currently acts on it.
- **Appointment reminders** (`appointmentReminderHours`) are stored in settings but no scheduler currently sends them — wire up a cron/queue calling the notification campaign path.
- **Membership proration and plan changes** are not implemented: a client cancels and joins again rather than switching plans, and a price change applies to new members only (existing subscriptions keep the price they signed up on, which is Stripe's behaviour).
- **Part-credit refunds** return only the card's share. An order paid for with credit *and* a card records the card charge as its payment, so refunding it refunds the card; the credit portion is on the order (`creditAppliedCents`) and in the credit ledger, but giving that part back is a manual adjustment for now. An order paid for entirely with credit refunds entirely to credit.

## Recommended next steps

1. Add a background job runner (e.g. a cron-triggered route or a queue) for: appointment reminders and loyalty point expiry. Membership renewals are Stripe's own schedule, and scheduled campaigns and membership suspensions already run from `/api/cron/marketing` and `/api/cron/memberships`.
2. Move rate limiting to a shared store for multi-instance deployments.
3. Add end-to-end browser tests (e.g. Playwright) for the golden paths, complementing the current integration-test coverage of business logic.
4. Wire up real Resend/Twilio/Web Push credentials and remove the mock fallbacks once the business is ready to send live notifications.
5. Add drag-and-drop reordering for catalogue items (`sortOrder` fields already exist; the current admin UI edits them via a plain "Save changes" form field rather than drag handles).
