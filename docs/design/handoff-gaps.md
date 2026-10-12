# Pirs v2 handoff — open gaps

Everything here was found while building stage 1 (the design system). None of it
is a stage 1 change; each entry says which stage it belongs to and what the
decision is. Nothing on this list is lost by shipping stage 1.

## Contrast: two values in the handoff palette fail WCAG AA

Measured with the WCAG 2.1 formula against the handoff's own neutrals
(`--bg` #FFFFFF, `--surface-2` #F5F5F4, `--surface-3` #EBEBEA). The client app
takes a client's zoom away, so a pale pairing cannot be rescued by pinching —
which is why these are tested, in `tests/client-app-zoom.test.ts`.

### `--success` #13804A on `--success-tint` #E3F4EA — 4.36:1

This is the PAID badge, the colour's headline use, so it is not a corner case.

| on | ratio | |
|---|---|---|
| white | 4.98 | pass |
| surface-2 | 4.57 | pass |
| success-tint | **4.36** | **fail** |
| surface-3 | **4.18** | **fail** |

Minimal correction: **`#137D49`** — tint 4.53, white 5.18, surface-2 4.74. Visually
indistinguishable from the handoff value. Still 4.34 on surface-3, so a success
label on a surface-3 track needs a darker value again.

For comparison the other two status colours are fine on their tints:
warning #8A4D00 on #FDF0DB = 5.94, danger #C42B1C on #FCE9E7 = 4.84.

### `--text-3` #6E6E6A on `--surface-3` #EBEBEA — 4.29:1

| on | ratio | |
|---|---|---|
| white | 5.12 | pass |
| surface-2 | 4.69 | pass |
| surface-3 | **4.29** | **fail** |

The design's segmented control puts inactive labels on a surface-3 track, which
is exactly this pairing. Until the value is settled those labels use `--text-2`
(6.38 on surface-3).

Minimal correction: **`#6A6A67`** — surface-3 4.55, surface-2 4.97, white 5.43.

**Decision needed:** adjust the two token values as above, or keep the handoff's
hexes and forbid the two failing pairings in the design. The tokens are
unchanged in stage 1 either way; the test pins both shortfalls so they cannot
drift out of sight.

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
