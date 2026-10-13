# Pirs v2 handoff — open gaps

Everything here was found while building stage 1 (the design system). None of it
is a stage 1 change; each entry says which stage it belongs to and what the
decision is. Nothing on this list is lost by shipping stage 1.

## Contrast: two handoff values were darkened (resolved)

Measured with the WCAG 2.1 formula against the handoff's neutrals (`--bg`
#FFFFFF, `--surface-2` #F5F5F4, `--surface-3` #EBEBEA). The client app takes a
client's zoom away, so a pale pairing cannot be rescued by pinching — which is
why these are tested, in `tests/client-app-zoom.test.ts`.

Both values were changed to the smallest darkening that clears AA. Neither is
distinguishable from the handoff's colour side by side.

| token | handoff | now | what forced it |
| --- | --- | --- | --- |
| `--success` | #13804A | **#137D49** | the PAID badge on `--success-tint`: 4.36 -> 4.53 |
| `--text-3` | #6E6E6A | **#6A6A67** | segmented-control labels on `--surface-3`: 4.29 -> 4.55 |

One pairing is still out and is forbidden rather than fixed: `--success` on
`--surface-3` measures 4.34, so a success label does not go on a grey track.
Darkening further to clear it would have pushed the green visibly towards
black. The test pins this.

For the record, the other status colours were always fine: warning #8A4D00 on
#FDF0DB = 5.94, danger #C42B1C on #FCE9E7 = 4.84.

## Naming: "Credit"

Decided: one word, **Credit**, in the client app and the clinic portal — not
"Patient App Cash" and not "account credit". The handoff uses "Patient App
Cash" throughout. The copy change lands in the screen stages, not here.

## Promo code at checkout

The handoff's checkout has an "Add a promo code" row. The app has promo codes
(`lib/promo-codes.ts`) but no client-facing action to apply one: `clientCheckoutAction`
takes a loyalty reward and nothing else. The slot is filled with "Use a reward",
which is the thing a client can actually do today. Wiring a code through
checkout is a payment-logic change and belongs in its own piece of work.

## Prices that include VAT, and prices that do not

The handoff assumes VAT-inclusive prices throughout ("Total incl. VAT", "All
prices include VAT"). The app also supports adding tax on top, per clinic, via
`TenantSettings.taxRateBasisPoints` — the seed clinic uses 7.25%. The cart now
adds that tax the same way `clientCheckoutAction` does, so the figure under
"Total incl. VAT" is the figure charged either way. Worth deciding whether a
tax-on-top clinic should see a different label; "incl. VAT" is at least true
for both.

## The client number is not searchable

Scan shows a client number, as the board does. It is derived from the profile
id (`lib/client-number.ts`) rather than stored, so there is nothing to keep
unique and nothing to backfill — but it also means nobody at the desk can look
a client up by it. If that is wanted it needs a real column, a unique index and
a search in the clinic portal. Until then it identifies a client on a screen
somebody is already holding, next to the QR that does the actual work.

## Member points multiplier

The handoff shows a points multiplier on the membership card. The app has no
multiplier: `LoyaltyProgramme` awards points per euro and per event, and a
membership's benefits are credit, discounts and included sessions. Either the
multiplier becomes a real benefit type or the card drops it. Later stage.

## `booking_url`

The handoff's booking screens assume an in-app booking flow. The app also
supports a clinic sending clients to an external booking link
(`TenantSettings`, booking mode), and the handoff has no state for that. The
booking stage needs both.

## Session packages

The handoff's shop shows single treatments only. The app sells session packages
(several sessions of a treatment, with expiry, transfer and redemption rules),
and those need their own card, their own detail state and their own place on the
client record. Later stage.

## The portal's sidebar is six items, not the handoff's four

The handoff's sidebar is Dashboard, Clients, App Builder, Shop Summary. The
portal's is Home, Appointments, Client Profiles, Shop Summary, Memberships,
App Builder — six, fixed, and enforced by `tests/nav.test.ts` so that it cannot
quietly grow. Appointments and Memberships are real pages with no home in the
handoff's four.

Reconciling them is an information-architecture decision, not a visual one:
either those two pages move inside Clients and App Builder, or the handoff's
sidebar gains them. Stage 5 left the six as they are and restyled them.

## Settings sections are not placeholders

An earlier note here said the nine App Builder → Settings sections were
placeholder text. They are not, and have not been for some time: General,
Branding, Team, Locations, Loyalty rules, Booking, Notifications, Integrations
and Audit log all read and write real data. Nothing in stage 5 had to be left
as a placeholder.

What the handoff adds to them is new behaviour rather than new styling — the
per-treatment booking links that Booking's notice counts, the Text check in the
offer and product editors, and session package transfer and expiry. Those are
features, and were explicitly outside stage 5.
