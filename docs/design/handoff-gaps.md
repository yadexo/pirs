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

## Settings placeholders

Nine App Builder → Settings sections and the portal's own settings are not in
the handoff at all. They are real screens with real forms; they will need a
design pass of their own rather than being derived from the client app's.
