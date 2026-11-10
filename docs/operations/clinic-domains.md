# Giving a clinic its own domain

A clinic can have its clients use an address of its own —
`app.clinicname.nl` — instead of the shared `login.deza.ai/clinicname`. On
that host the clinic is the whole site: `/` is its home, `/shop` its shop, and
the slug never appears.

The shared address keeps working. That is deliberate and should stay that way:
it is what every client who already installed the app has on their home
screen, and taking it away would break it.

## Before you start

Three environment variables, all secret and server-side only:

| | |
|---|---|
| `VERCEL_API_TOKEN` | A token that can edit this project's domains. |
| `VERCEL_PROJECT_ID` | The project the domain is attached to. |
| `VERCEL_TEAM_ID` | Only for a project owned by a team. Leave unset otherwise. |

With the first two unset the feature is off: the panel says so and every
action refuses rather than half-attaching a domain nobody can verify. They are
bound per deployment, so setting them needs a redeploy, not just a save.

You also need the clinic to be able to edit their own DNS, or to have someone
who can.

## Attaching it

1. Open **/agency**, find the clinic, and click the globe. That is
   `/agency/clinics/<id>` — the platform's own page for a clinic, as opposed
   to `/m/<id>`, which is the clinic's portal.
2. Type the domain, e.g. `app.clinicname.nl`, and press **Add domain**.

   It must be a subdomain. The apex `clinicname.nl` is refused: an apex cannot
   point here with a CNAME, and taking over a clinic's whole domain is more
   than they are asking for — their website almost certainly lives there.
   Also refused: anything under `deza.ai`, the hosting provider's own domains,
   local-only names, IP addresses, and any host another clinic already holds.

3. The page then shows the DNS records to add. Send them to whoever manages
   the clinic's DNS. The **name** is relative to the zone — `app`, not
   `app.clinicname.nl`. Typing the whole host there is the usual way this goes
   wrong.

   | Type | Name | Value |
   |---|---|---|
   | CNAME | `app` | `cname.vercel-dns.com` |

   A TXT record appears beside it when Vercel wants proof of ownership, which
   it does when the domain is already attached to some other Vercel project.

4. Wait. DNS usually takes minutes and sometimes longer. **Check now** asks
   Vercel to look again, and an hourly job does the same for every domain
   still waiting, so a domain that starts working at three in the morning is
   routing by four.

Once it says **Verified**, the clinic's app is live on that host, and every
link the platform generates for that clinic — QR codes, the join link,
welcome emails, password resets, push notifications — points there instead.

## Tell the clinic's clients

Three things change for anyone already using the app, and none of them happen
by themselves:

- **They have to sign in again** on the new address. Cookies belong to one
  origin; there is no way around this.
- **They have to reinstall** to get the home-screen app on the clinic's own
  domain, and **turn notifications back on** afterwards. A push subscription
  belongs to the origin that created it.
- Until they do, their old install keeps working on the shared address. If
  somebody installs both, **they get every notification twice**. There is no
  dedupe: the two are different browsers' subscriptions as far as anything
  here can tell.

The clinic should reprint anything carrying the old QR code at the same time —
the code itself is regenerated automatically, but paper is not.

## Removing it

**Remove** on the same page takes it off Vercel first and then deletes the
row. If Vercel refuses, the row stays and says why — a row deleted while the
domain stayed on the project would leave a host nobody can account for, and
attaching it again would fail against an owner the console cannot show.

Afterwards that clinic's links go back to the shared address. Clients who
installed from the clinic domain will find it stops resolving; they reinstall
from the shared address.

## When it will not verify

- **The CNAME is on the wrong name.** `app.clinicname.nl.clinicname.nl` is
  what you get from typing the full host into a field that wanted `app`.
- **The domain is on another Vercel project.** Vercel says so, and the panel
  repeats it. It has to be removed there first.
- **An apex.** Vercel refuses the CNAME; some registrars offer ALIAS or
  ANAME records that work, but this platform does not support apex domains.
- **DNS is cached.** A record that was wrong and has been fixed can take as
  long as its old TTL to stop being wrong.

The panel shows the last error and when it last looked. `[domain]` lines in
the server logs carry the same outcomes as reason codes — never the host,
which is in the audit log, and never the Vercel token.

## Known limitations

Two things do not yet know about clinic domains. Neither loses data; both are
worth knowing before you promise a clinic something.

- **A QR code printed with the clinic's domain does not scan in the platform
  finder.** Scanning it inside the clinic's own app is fine. The finder on
  `login.deza.ai` only trusts hosts it knows, so a poster showing
  `app.clinicname.nl` reads as nothing there. Clients normally scan the code
  the clinic shows them, which opens the right place directly, so this is a
  narrow case.
- **Notification tap focuses the wrong window, sometimes.** The service
  worker works out which clinic a window belongs to from the first path
  segment, which on a clinic domain is a page rather than a slug. The
  notification still opens the right page; it may open a new window instead
  of reusing one that is already there.

## What this does not change

Two-factor, the staff portal and the admin console never run on a clinic's
domain: `/login`, `/m/…`, `/agency` and the account pages are all refused
there, so no session cookie is ever set for the wrong origin. Another clinic's
slug on that host is simply a page that does not exist.

Apple Pay is registered on the clinic's own Stripe connected account when the
domain verifies, because Apple Pay only appears on a registered host. If the
clinic is not connected to Stripe yet, it is registered the next time its
account updates, or by `npm run prod:apple-pay`.
