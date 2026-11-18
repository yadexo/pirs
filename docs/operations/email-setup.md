# Transactional email (Resend) — one-time setup

## 1. DNS records for your sending domain

Resend needs your sending domain verified with SPF, DKIM and (recommended) DMARC
before it will send on your behalf. Do this once per domain, in whichever
registrar or DNS host manages it (Cloudflare, Route 53, your domain's own
panel).

1. Resend dashboard → **Domains → Add Domain**. The sending domain is
   **`mail.deza.ai`** — that is the domain verified in Resend. Production
   sends from `no-reply@mail.deza.ai`, staging from `staging@mail.deza.ai`:
   the **same** domain, no separate DNS needed (see §3).

   A subdomain keeps mail apart from the apex `deza.ai`, which is the
   marketing site's. Every `EMAIL_FROM` must be an address **on the verified
   domain** — `no-reply@deza.ai` is *not* on `mail.deza.ai`, and Resend
   refuses it (403, "domain is not verified").
2. Resend shows you the exact records to add. They look like this (your real
   values come from the dashboard, not this doc):

   | Type | Host | Value | Purpose |
   |---|---|---|---|
   | TXT | `send.deza.ai` (or similar) | `v=spf1 include:amazonses.com ~all` | SPF — authorises Resend's servers to send as you |
   | CNAME | `resend._domainkey.deza.ai` | `resend._domainkey.resend.com` (example) | DKIM — signs every message so receivers can verify it wasn't altered |
   | TXT | `deza.ai` or `_dmarc.deza.ai` | `v=DMARC1; p=none; rua=mailto:you@deza.ai` | DMARC — tells receivers what to do with mail that fails SPF/DKIM |

   Add exactly what Resend's dashboard shows — the subdomain and value are
   specific to your account and change if you re-add the domain.

3. **DMARC**: start with `p=none` (monitor only, nothing gets rejected) for a
   couple of weeks, watch the `rua` reports, then tighten to `p=quarantine`
   once you're confident everything legitimate is passing. Going straight to
   `p=reject` risks a legitimate email bouncing if something is misconfigured.

## 2. Verifying the domain

1. Add the records (DNS can take anywhere from a few minutes to a few hours
   to propagate).
2. Back in Resend → **Domains**, click **Verify**. A red "Not verified" badge
   means at least one record hasn't propagated or doesn't match exactly —
   Resend's own checker tells you which one.
3. Once it's green, create an API key: **API Keys → Create API Key**, scoped
   to **Sending access** only (not full account access).

## 3. Environment variables

| Variable | Production | Preview (staging) |
|---|---|---|
| `EMAIL_PROVIDER` | **`resend` — required** | `resend` |
| `RESEND_API_KEY` | an API key from the Resend account that owns `mail.deza.ai` | same key (one Resend account covers both — see note) |
| `EMAIL_FROM` | `no-reply@mail.deza.ai` | `staging@mail.deza.ai` |
| `APP_URL` | `https://app.deza.ai` | the staging URL |

- **`EMAIL_PROVIDER=resend` is required.** Setting the key and the address
  is not enough: without this variable every email goes to the built-in mock
  provider and nothing reaches Resend — not even a refused request in
  Resend's logs. It must be exactly `resend`: lowercase, no quotes, no
  spaces. In real production the mock refuses every email and logs an
  error (§6); on staging it logs and sends nothing.
- **`EMAIL_FROM` must be on `mail.deza.ai`**, the verified domain. Enter the
  bare address — no quotes around it. `Deza <no-reply@mail.deza.ai>` also
  works; the name part is replaced by the clinic's name on every send.
- **`APP_URL`** is the origin of the links in password-reset and staff and
  admin invite emails. Unset, those links point at `http://localhost:3000`.
- Changing an environment variable on Vercel only takes effect on the next
  deployment: **redeploy** after every change.

Both `EMAIL_FROM` addresses are on the **same verified domain**
(`mail.deza.ai`), so one set of DNS records covers both — Resend verifies the
domain, not each individual address on it. This matches
`docs/deployment/staging-setup.md`, which already has `EMAIL_FROM` as a
Preview-scoped Vercel variable.

The clinic's own name rides on top of whichever address you configure here —
every send uses `"<Clinic Name>" <the address in EMAIL_FROM>"` as the From
header (`lib/emails/sender.ts`), never the clinic's own domain, since Resend
only has your one domain verified.

## 4. What's already built

- `lib/providers/notifications/email.ts` — the Resend HTTP client. Not used
  at all until `EMAIL_PROVIDER=resend`; until then the mock provider
  (`lib/providers/notifications/mock.ts`) takes every email instead. With
  `resend` selected it still sends nothing unless both `RESEND_API_KEY` and
  `EMAIL_FROM` are set.
- `lib/emails/` — one branded HTML+plain-text template per transactional
  email (receipt, refund, password reset, welcome ×2, membership ×3, session
  expiry), built from the clinic's own logo and brand colour
  (`lib/emails/layout.ts`), never an unsubscribe link (none of these are
  marketing — see the file's own comment for why that's a hard rule, not an
  oversight).
- A staff-only preview at `/m/<merchantId>/email-preview`, gated off the real
  production domains the same way the demo portal index is
  (`lib/deploy-env.ts`) — see `docs/deployment/staging-setup.md` for what
  "real production" means here.

## 5. What is not in scope yet

No marketing/campaign email exists in the product yet (campaigns today are
push and in-app only), so the unsubscribe mechanism the law requires for
marketing mail has not been built — there is nothing for it to attach to.
`lib/emails/layout.ts`'s `emailLayout()` already accepts an `unsubscribeUrl`
and renders the footer link when one is given, so wiring that up is a small
addition whenever campaign email is built, not a redesign.

## 6. Checking that email actually goes out

Every reset, welcome and invite answers the person the same way whether or
not the email left, so check the logs (Vercel → the deployment → **Logs**),
not the screen:

- **At startup**, a deployment that cannot send email says so in a line
  starting `[email] This deployment cannot send email:` and naming each
  problem (`EMAIL_PROVIDER is not set`, `EMAIL_FROM is wrapped in quotes`,
  …). An error in Production, a warning on Preview. No such line means the
  three variables are present and well formed — not that Resend accepts them.
- **Per email**, search `[email]`:
  - `[email] kind=password_reset outcome=sent` — Resend accepted it; it is in
    Resend → **Logs**.
  - `outcome=failed reason=not_configured` — nothing was sent: either
    `EMAIL_PROVIDER` is not `resend` (Production also logs
    `EMAIL_PROVIDER is not "resend" in production: email NOT sent`), or the
    key or `EMAIL_FROM` is missing.
  - `outcome=failed reason=http_403` / `http_422` with Resend's own message
    after `detail=` — Resend refused it, e.g. an `EMAIL_FROM` that is not on
    `mail.deza.ai`, or a key from another Resend account.
  - `reason=timeout` / `reason=network` — Resend could not be reached.
- **For a password reset**, search `[reset]` as well. `outcome=sent` means an
  account was found and Resend accepted the email; `send_failed` means an
  account was found and the email failed (the `[email]` line says why).
  `no_such_user`, `no_account_of_type`, `ambiguous_email` and
  `rate_limited` mean no email was attempted — the address has no account of
  that kind (an admin reset only reaches a platform admin), or it was asked
  more than 3 times in the hour.

No log line ever contains a recipient's address.
