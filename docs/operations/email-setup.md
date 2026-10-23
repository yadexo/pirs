# Transactional email (Resend) — one-time setup

## 1. DNS records for your sending domain

Resend needs your sending domain verified with SPF, DKIM and (recommended) DMARC
before it will send on your behalf. Do this once per domain, in whichever
registrar or DNS host manages it (Cloudflare, Route 53, your domain's own
panel).

1. Resend dashboard → **Domains → Add Domain**. Enter the domain you'll send
   from — e.g. `pirs.io` (production sends from the live domain; staging from
   `staging@pirs.io`, the **same** domain, no separate DNS needed — see §3).
2. Resend shows you the exact records to add. They look like this (your real
   values come from the dashboard, not this doc):

   | Type | Host | Value | Purpose |
   |---|---|---|---|
   | TXT | `send.pirs.io` (or similar) | `v=spf1 include:amazonses.com ~all` | SPF — authorises Resend's servers to send as you |
   | CNAME | `resend._domainkey.pirs.io` | `resend._domainkey.resend.com` (example) | DKIM — signs every message so receivers can verify it wasn't altered |
   | TXT | `pirs.io` or `_dmarc.pirs.io` | `v=DMARC1; p=none; rua=mailto:you@pirs.io` | DMARC — tells receivers what to do with mail that fails SPF/DKIM |

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
| `EMAIL_PROVIDER` | `resend` | `resend` |
| `RESEND_API_KEY` | your Resend API key | same key (one Resend account covers both — see note) |
| `EMAIL_FROM` | `no-reply@pirs.io` (or your chosen local part) | `staging@pirs.io` |

Both `EMAIL_FROM` addresses are on the **same verified domain** (`pirs.io`),
so one set of DNS records covers both — Resend verifies the domain, not each
individual address on it. This matches `docs/deployment/staging-setup.md`,
which already has `EMAIL_FROM` as a Preview-scoped Vercel variable.

The clinic's own name rides on top of whichever address you configure here —
every send uses `"<Clinic Name>" <the address in EMAIL_FROM>"` as the From
header (`lib/emails/sender.ts`), never the clinic's own domain, since Resend
only has your one domain verified.

## 4. What's already built

- `lib/providers/notifications/email.ts` — the Resend HTTP client. Does
  nothing (and the mock provider logs to the console instead) until
  `EMAIL_PROVIDER=resend` and both `RESEND_API_KEY` and `EMAIL_FROM` are set.
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
