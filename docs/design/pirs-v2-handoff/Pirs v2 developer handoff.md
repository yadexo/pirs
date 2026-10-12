# Pirs v2 · Developer handoff

Oct 8, 2026 · @Y

## Implementation notes

Added during the build, not by the designer.

- **"Credit", not "Patient App Cash".** Wherever this document says Patient App
  Cash, the product says **Credit** — one word, in the client app and in the
  clinic portal. The copy lands in the screen stages.
- Open gaps between this handoff and how the app works are tracked in
  [handoff-gaps.md](../handoff-gaps.md), including two colour values here that
  do not clear WCAG AA.

## Overview

Pirs is a multi-clinic SaaS with two front ends that share one design system (v2):

- **Client app** – a white-label web app that clients install on their iPhone home screen (390 pt wide, runs full screen). Each clinic sets one brand color; everything else stays black and white.
- **Clinic portal** – the desktop tool (1440 wide, tablet 1024 supported) where clinic staff manage clients, redeem items, build the shop and configure the app.

**Design principles**

1. Confident black and white base. The clinic brand color appears in one slot per screen (tags, points, active states, the Scan button). The main action is always the black button.
2. One main action per screen. Secondary actions are grey or outline.
3. Readable by default: no text smaller than 14 px, inputs 16 px (stops iOS zoom), tap targets at least 44 × 44.
4. Every screen has a set-up clinic state and an empty (new clinic) state.
5. Prices always include VAT and the total is shown before paying.

**Source of truth** – the design canvas (Design artifact "Pirs Client App Redesign"). Pages: *v2 · Design system*, *v2 · Client app*, *v2 · Clinic portal*. The v1 pages stay on the canvas as reference only and should not be built.

**Approved scope** – client app (all v2 screens including the three payment result variants) and clinic portal (Dashboard, Clients, App Builder with six tabs, nine Settings sections, top bar actions).

## Design tokens

One token set serves both the client app and the clinic portal: a black, white and grey base plus one brand slot per clinic. Every brand color on screen reads from a role below, never from a raw hex.

### Neutrals and status

| Token | Value | Use |
| --- | --- | --- |
| `bg` | #FFFFFF | App screens, cards in the portal |
| `surface-2` | #F5F5F4 | Grey cards, inputs, chips, portal page background |
| `surface-3` | #EBEBEA | Segmented track, pressed state, skeleton base |
| `line` | #E6E6E4 | Dividers, card edges, progress track |
| `line-strong` | #CFCFCC | Input borders, unselected radio |
| `disabled` | #A8A8A4 | Disabled text and icons only |
| `text-3` | #6E6E6A | Meta, struck-through prices, inactive tabs (5.1:1 on white) |
| `text-2` | #545450 | Secondary text (7.6:1 on white) |
| `ink` | #0D0D0D | Text, the main button, active nav |
| `success` / `success-tint` | #13804A / #E3F4EA | PAID, READY, passed checks |
| `warning` / `warning-tint` | #8A4D00 / #FDF0DB | PENDING, "Booking link missing", setup warnings |
| `danger` / `danger-tint` | #C42B1C / #FCE9E7 | Errors, Log out, blocked text check |
| `scrim-sheet` | rgba(0,0,0,0.45) | Behind client app sheets |
| `scrim-drawer` | rgba(13,13,13,0.32) | Behind portal drawers |

Status is never color alone: every status ships as a labelled badge or with an icon.

### Brand slot

The clinic sets one hex (`--brand`). The app derives a ramp in OKLCH (same hue and chroma, new lightness), then resolves each role by contrast when the clinic saves its color. Store the resolved roles with the clinic.

| Ramp step | Formula (CSS relative color) |
| --- | --- |
| `brand-50` | `oklch(from var(--brand) .975 calc(c*.25) h)` |
| `brand-100` | `oklch(from var(--brand) .95 calc(c*.40) h)` |
| `brand-200` | `oklch(from var(--brand) .90 calc(c*.60) h)` |
| `brand-300` | `oklch(from var(--brand) .82 calc(c*.85) h)` |
| `brand-600` | `oklch(from var(--brand) calc(l*.86) c h)` |
| `brand-700` | `oklch(from var(--brand) calc(l*.72) c h)` |
| `brand-800` | `oklch(from var(--brand) calc(l*.60) calc(c*.95) h)` |
| `brand-900` | `oklch(from var(--brand) calc(l*.48) calc(c*.90) h)` |

| Role | Rule | Used for |
| --- | --- | --- |
| `brand` | The clinic's hex as entered | Offer and discount tags, progress fill, total chip on the cart bar |
| `brand-soft` | `brand-100` | No-photo placeholders, soft badges (MEMBER), member-price highlights |
| `brand-line` | `brand-200` | Placeholder ripples, focus rings, Scan button ring when active |
| `brand-strong` | First of 500 to 900 with 4.5:1 on `brand-soft` | Member prices, "Members pay €X →", active-tab marker, brand text |
| `on-brand` | White if 4.5:1 on `brand`, else ink | Text on a `brand` fill |
| `brand-fill-white` | First of 500 to 900 with 3:1 for white | Scan button, icon tiles with a white icon, success check |
| `brand-deep` | First of 500 to 900 with OKLCH L ≤ 0.46 | Large banners with white text (personal discount) |

| Example clinic | `--brand` | `brand-strong` | `brand-fill-white` | `brand-deep` | `on-brand` |
| --- | --- | --- | --- | --- | --- |
| Soft pink | #E9A6B8 | #814959 (800) | #A06374 (700) | #623040 (900) | ink |
| Deep green | #1E4D3B | #1E4D3B (500) | #1E4D3B (500) | #1E4D3B (500) | white |
| Navy | #1C2B4F | #1C2B4F (500) | #1C2B4F (500) | #1C2B4F (500) | white |

The reference implementation of this derivation (JavaScript, about 40 lines) is in every board's script on the canvas, as `brandTokens()`.

### Typography

Hanken Grotesk 400 to 800, fallback `-apple-system, system-ui`. No text is smaller than 14px, inputs are 16px (prevents iOS zoom), prices use tabular figures. Sizes in rem so they follow the phone's text size.

| Token | Size / line height | Weight · tracking | Use |
| --- | --- | --- | --- |
| `display` | 34 / 40 | 800 · −2.5% | App screen titles |
| `title-1` | 28 / 34 | 800 · −2% | Big numbers, sheet titles, product name in detail (portal page titles use 32 / 38) |
| `title-2` | 22 / 28 | 700 · −1.5% | Section headers |
| `title-3` | 18 / 24 | 700 · −1% | Card titles, list rows, portal card titles |
| `body` | 16 / 24 | 400 | Body copy, input text |
| `label` | 16 / 20 | 600 | Buttons, product names, nav items |
| `small` | 15 / 20 | 400 | Secondary lines, table cells |
| `caption` | 14 / 18 | 500 | Meta, struck prices, tab labels. The minimum |
| `tag` | 14 / 18 | 700 | Tags on photos, badges |

### Spacing, radius, elevation, motion

| Group | Tokens |
| --- | --- |
| Spacing | `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-5` 20 · `space-6` 24 · `space-8` 32 · `space-10` 40 · `space-12` 48 |
| Radius | `radius-sm` 8 (tags) · `radius-md` 16 (buttons, inputs) · `radius-lg` 20 (photos, portal cards) · `radius-xl` 24 (app cards, banners) · `radius-2xl` 32 (sheet top) · `radius-full` (chips, Scan, + button) |
| Elevation | `flat`: none (cards are grey fills) · `raised`: 0 6px 20px rgba(0,0,0,.08) · `floating`: 0 10px 30px rgba(0,0,0,.22) (cart bar, toasts) · `sheet`: 0 −10px 40px rgba(0,0,0,.18) · `drawer`: −10px 0 40px rgba(0,0,0,.16) |
| Motion | press 120ms, scale .97 · sheets 420ms cubic-bezier(.32,.72,0,1) · cart bar slides up 280ms · skeleton shimmer 1.4s loop, shown after 300ms · Reduce Motion: fade only |

### Layout

| Surface | Values |
| --- | --- |
| Client app | 390 wide reference, 20 gutter, `env(safe-area-inset-top)` (59) and `env(safe-area-inset-bottom)` (34); `viewport-fit=cover` |
| Bottom nav | 64 of controls + 34 safe area = 98; Scan button 64 round, centered on the bar's top edge, rises 32; cut-out radius 38; columns 73 / 74 / 96 / 73 / 74 |
| Cart bar | 56 tall, 16 from the edges, bottom 140 (10 above Scan) |
| Portal | Sidebar 256 (desktop) or 84 icon-only (tablet, under 1200 wide); content padding 24 40 48; cards gap 16; drawers 520 wide (560 for editors) from the right |

## Client app components

All components live on *v2 · Design system* (boards 02 Bottom navigation, 03 Components, 04 Shopping and Home blocks, 05 Empty and loading).

### Buttons

| Variant | Size | Style | Use |
| --- | --- | --- | --- |
| Primary | 56 tall, radius 16, 17 / 700 | `ink` fill, white text | The one main action per screen. On money actions the amount sits right-aligned inside the button ("Pay €132.50") |
| Brand | 56 tall, radius 16 | `brand` fill, `on-brand` text | Only inside brand surfaces (personal offer banner). Never next to a Primary |
| Grey | 48 tall, radius 14, 16 / 600 | `surface-2` fill | Secondary actions ("View my items", "Buy again" in compact rows) |
| Outline | 48 tall, radius 14 | white, 1.5 px inset `ink` ring | Secondary next to a Primary ("Buy again" beside "Book appointment") |
| Small pill | 40 tall, radius full, 14 / 700 | grey or ink | Chips, filters, inline "Book" on result rows |
| Add (+) | 36 round on product cards (44 hit area) | `ink` fill, white plus | Adds one unit to the cart; turns into a − 1 + stepper |

States: pressed scales to .97 for 120 ms; disabled uses `surface-3` with `disabled` text; loading keeps the width and swaps the label for a spinner.

### Inputs and controls

- Text field: 52 tall, radius 16, `surface-2` fill, 16 px text, label above (14 / 600). Error: `danger` ring and a message below.
- Switch 52 × 32 (ink when on), radio 22 (7 px ink ring when selected), quantity stepper 48 tall pill.
- Segmented control: `surface-3` track, white selected segment, 44 tall.

### Tags and prices

- Tag: 26 tall, radius 8, 14 / 700. Kinds: brand (offers, "20% off"), white with shadow on photos ("Popular"), soft (`brand-soft` + `brand-strong`, MEMBER), status tints.
- Price block: current price 800 weight, tabular figures; a struck price only when there is a real earlier price (`text-3`, line-through).
- **Members pay line:** non-members see the regular price in bold with "Members pay €X →" below in `brand-strong` (14 / 600), linking to Join membership. Members see the member price as the main price with a MEMBER tag.

### Product card

Photo (radius 20, 4:3 in grids, 1:1 in rows) with up to two tags, name (16 / 600, two lines max), meta line (duration or size, 14 / 500 `text-2`), price block and the + button bottom right. Without a photo: `brand-soft` placeholder with the first letter or a category icon (never stock imagery).

### Bottom navigation

Five items: Home, Shop, Scan, Rewards, Profile. 98 tall including the safe area, white with a top hairline, cut-out of radius 38 around the Scan button. Scan is a 64 round button in `brand-fill-white` with a 28 px white QR-scan icon (four corner brackets plus a center line) and a "Scan" label under it. Active item: `ink` icon and label with a 4 px `brand-strong` marker; inactive `text-3`. The Rewards item shows a dot when a reward is ready.

### Cart bar

Floating black bar, 56 tall, 16 from the edges, bottom 140 so it sits above the Scan button. Left: item count; right: total incl. VAT in a `brand` chip. Appears with a 280 ms slide when the cart has items; tapping opens the Cart sheet.

### Sheets

From the bottom, top 54, radius 32 top corners, 40 × 5 grabber, `scrim-sheet` behind. Header: back (44), title (`title-1`), close (44 grey round). Footer holds the one Primary button with 34 px bottom padding. Used for Product detail, Cart, Checkout, Payment, Join membership.

### Feedback

- Toast: black, radius 16, `floating` shadow, 3 s, with one optional action ("Undo").
- Empty state: 64 round `brand-soft` icon tile, `title-3` heading, one sentence, at most one button.
- Skeletons: shimmer 1.4 s on `surface-3`, only shown after 300 ms; Reduce Motion shows a static fill.

### Payment method row

Radio rows for Apple Pay, iDEAL | Wero, Klarna and Card, each with its official mark at 24 tall on the left (unaltered artwork, supplied by the provider). The Apple Pay row is only shown on devices that support it.

## Client app screens

Board names in brackets match the canvas (*v2 · Client app*). Tab screens show the bottom nav; sheets cover it. Example clinic: Lumière Skin Clinic (set up) and Studio Nova (new, empty).

### Home

**Home · set-up clinic (W2Home).** Scrolling page: the clinic header plus eight sections, top to bottom:

1. **Clinic header** – cover photo, logo, "Welcome back, {first name}", clinic name and address with a Directions link (opens Maps).
2. **Wallet strip** – Patient App Cash balance, membership status (NOT A MEMBER or the plan name), points. Each tile links to its detail (Profile, Profile → Membership, Rewards).
3. **Featured offers** – horizontal cards with a brand discount tag, title, scope and the real end date ("until 31 Oct"). Show only offers that are active; hide the section when there are none.
4. **Just for you** – personal discount banner in `brand-deep` with one Brand button ("Use now"). Only when the client has a personal offer.
5. **Items to redeem** – "You have N items to redeem", links to Scan. Hidden at 0.
6. **Points progress** – points, next reward name and points to go, progress bar in `brand`.
7. **Popular treatments** and **Skin care products** – product card rows with "See all" to the matching Shop tab.
8. **Membership pitch** – saving based on the client's last visits, price per month, Become a member (→ Shop · Memberships). Hidden for members.
9. **Buy again** – the client's past items. A treatment with a booking link shows "Buy again" (outline, adds to cart) and "Book appointment ↗" (black) side by side; an item without a link shows "Buy again" only.

The cart bar floats above the nav when the cart has items.

**Home · new clinic (W2HomeEmpty).** Clinic initials instead of a logo, zero balances, a "Get started" checklist (Add to Home Screen, Turn on notifications, Complete your profile; "0 of 3 done"), "How rewards work" in three steps and a "The shop is being stocked" card with Notify me.

### Shop

**Shop · Browse (W2Shop).** Segmented control Browse / Memberships / Treatments, cart icon with count. Category chips (All, Facials, Body, Skin care, Packages, Gift cards), a membership strip ("Members save 10%"), rows of treatments, **session packages**, products and gift cards, the note "All prices include VAT. Package savings compare with buying the same sessions one by one." and the cart bar.

**Shop · Memberships (W2ShopMemberships).** One card per plan with price per month, perks, the full terms line (price incl. VAT, renews automatically every month, cancel anytime in Profile → Membership) and a button to Join membership. Reassurance row: Cancel anytime, Perks start today, Pay securely.

**Shop · Treatments (W2ShopTreatments).** Chips by category, list rows with duration and points earned, then a **Packages** group (sessions, validity, total, price per session and saving). Footer: "All prices include VAT. Package savings compare with buying the same sessions one by one. Results vary per person."

**Package detail sheet (W2Package).** See *Custom plans (session packages)* in the portal section for the content and rules.

**Shop · new clinic (W2ShopEmpty).** Empty state with Notify me and an Add to Home Screen tip.

**Product detail sheet (W2Product).** Photo with tags, name, price, duration and points, description, options (1 session / 3 sessions with the saving), quantity, Primary "Add to cart €X". Treatments with a booking link add: "After buying, book your time on {clinic}'s booking page." Treatments end with "Results vary per person."

### Buy flow

**Cart (W2Cart).** Line items with steppers, membership saving nudge ("Save €X on this order with Glow Membership · Join", hidden for members), "Goes well with" suggestions, total incl. VAT, points to earn, Primary "Checkout €X".

**Checkout (W2Checkout).** Client details with Edit, Use Patient App Cash switch, promo code row, line items, credits, "Total incl. VAT", points to earn. Booking note when the order contains a treatment with a link. Primary "Continue to payment €X".

**Payment (W2Payment).** Total to pay incl. VAT with "No extra costs", payment method rows (iDEAL | Wero, Card, Apple Pay, Klarna) with official marks. Primary "Pay €X". Hint text changes per method ("You'll confirm in your banking app.").

**Payment result (W2Result, W2ResultMulti, W2ResultNoLink).** "Payment complete", receipt email line, a **Next step** card, points earned and progress, the order summary (PAID, lines, "Total paid, incl. VAT", payment method) and "Back to home". The Next step card depends on the order:

| Order contains | Next step card |
| --- | --- |
| One treatment with a link (W2Result) | "Book your treatment", one row with the treatment and a black "Book" button. Products in the same order: "{product} is ready at the desk." |
| Several treatments with links (W2ResultMulti) | "Book your treatments", one row and "Book" button per treatment |
| Only items without a link (W2ResultNoLink) | "Your items are ready – show your code at the desk" and "View my items" (→ Profile · My items) |

Mixed orders list the linked treatments as Book rows and mention the rest under the rows. Footnote: "You can also book later in My items."

**Join membership (W2JoinMembership).** Plan summary, price per month, first payment today, next payment date, "To pay today, incl. VAT", "No extra costs.", auto-renew line, how to cancel, payment method with Change, Primary "Pay €X and join" and the consent line below.

### Scan, Rewards and Profile

**Scan (W2Scan).** Large QR code with the client's name and number ("PIRS 4821 3390"), points and Patient App Cash, "Ready to redeem" list with READY badges and a brightness tip. Screen brightness is not changed by the app.

**Rewards (W2Rewards).** Points and cash, progress line to the next reward, "Ready to redeem" rewards with Redeem, "Keep earning" list with points still needed, "Earn faster" explainer (€1 = 1 point, members earn double).

**Rewards · new clinic (W2RewardsEmpty).** Zero balances, "No rewards yet" with "Tell me when they're live"; points earned before launch are kept.

**Profile · My items (W2Profile).** Header (avatar, name, membership, points), tabs My items / Membership / Account. *Ready to use*: packages first ("3 of 5 sessions left, valid until {date}", a Book button per covered treatment with a link, "Book at the desk" for the others, and "Give sessions to someone" when transferable); a treatment with a link shows sessions left and "Book appointment" (opens the link); a treatment without a link shows "N sessions left · show your code at the desk" and no button; rewards show "show your code at the desk". *Past items* (used up or expired) with "Buy again". Link to Orders and receipts.

**Give sessions (W2GiveSessions).** Sheet opened from a transferable package in My items; see *Custom plans (session packages)* for the rules.

**Profile · Membership (W2ProfileMembership).** Non-member: saving based on the last 3 orders, price per month with terms, Join, perks list, how to cancel. Member (to build): plan, next payment date and amount, perks used, "Cancel membership" (one confirm step, perks stay until the end of the paid month).

**Profile · Account (W2ProfileAccount).** Personal details, saved payment methods, language, Notifications, Add to Home Screen, contact the clinic, terms and privacy, Log out (`danger`), "Powered by Pirs".

**White-label (W2Brands).** Reference only: the same Home in three clinic colors to check the brand roles.

## Clinic portal components

The portal uses the same tokens as the app. Reference board: *06 Clinic portal kit* (PKit) on *v2 · Clinic portal*.

### Shell

- **Page:** `surface-2` background, white cards (radius 20, no shadow), content padding 24 / 40 / 48, gap 16.
- **Sidebar (256, white):** clinic logo and name with a "Switch clinic" dropdown (for staff of more than one clinic), main nav – Dashboard, Clients, App Builder, Shop Summary – as 48-tall rows (active: `surface-2` fill, 700 weight, `ink` icon). Bottom: Help and support, signed-in user. Under 1200 wide it collapses to 84 icon-only with the same order and `aria-label`s.
- **Top bar (72):** right-aligned white buttons with a 1 px `line-strong` ring, 48 tall: **Redeem** (opens the client search and then the Redeem drawer), **Scan QR** (opens the Scan QR drawer), **View app** (opens the clinic's client app in a new tab). No search field and no bell in the top bar.

### Page header

Optional breadcrumb (14 / 500 `text-2`), page title 32 / 38 weight 800, one-line description, actions on the right. At most one Primary per page; other actions are white or grey.

### Buttons

Same variants as the app at 44 tall and 15 px: Primary (`ink`), Grey (`surface-2`), Outline, White (white with a `line` ring – used on grey surfaces and in the top bar). Destructive actions use `danger` text on a white button and always confirm.

### Tables

Header row 44 tall on `surface-2` with radius 12; body rows at least 64 tall with a hairline between rows; 16 gap between columns; first column holds the person or item (avatar or thumbnail, name, secondary line). Status as labelled badges. Row actions on the right as a small white button or a ⋯ menu. Long tables paginate at 25 rows.

### Forms

- Field: label 14 / 600 above, input 48 tall, radius 14, 16 px text, white with a `line-strong` ring (1.5 px `ink` on focus). Hint below in 14 / 500 `text-2`. Error: `danger` ring, message with an icon below, and the field label gets "(required)" when it is required.
- Toggle 44 × 26, segmented control (44 tall, `surface-3` track), tabs (48 tall, 2 px `ink` underline on the active tab).
- Logo slot: dashed `line-strong` box where an uploaded logo goes.

### Drawers

From the right, 520 wide (560 for editors), full height, `scrim-drawer` behind, `drawer` shadow. Header: title (`title-2`), one-line subtitle, close (44 round grey). Body scrolls; footer is sticky with Cancel (grey) and one Primary. Used for Redeem, Scan QR, Edit treatment, Offer editor, invite team member.

### Data

- **Stat tile:** label (14 / 600 `text-2`), value 28 / 34 weight 800, change against the previous period with an arrow and the word up or down (never color only), optional note.
- **Bar chart:** fixed 676 wide, 240 tall, "nice" tick values, `ink` bars with the highlighted bar in `brand`, values on hover and in a table fallback for screen readers.
- **Horizontal bars:** share per category with the value written out.

### Notices

Inline banners in three kinds: info (`surface-2`), warn (`warning-tint` + `warning`, used for "Booking link missing" and setup warnings), ok (`success-tint` + `success`). Icon plus one sentence plus at most one link.

### Text check

Offer, product and notification text fields run the content rules in section *Content and compliance rules* while typing: a blocked word shows a `danger` message under the field and disables Save until it is fixed.

## Clinic portal screens

All pages sit in the shell (sidebar + top bar). Board names in brackets match *v2 · Clinic portal*. Roles: Owner sees everything; Manager has no payouts or team; Staff only gets Scan QR, Redeem and client lookup.

### Top bar actions

- **Redeem** – pick a client (search by name, email, phone or client number), then the Redeem drawer from Client · Items opens.
- **Scan QR (PScanQR)** – drawer with a camera preview ("Point the camera at the client's code. It's on the Scan tab in their app."), or type the client number. "Find client" opens the client's Items tab, ready to redeem.
- **View app** – opens the clinic's client app (`{clinic}.pirs.io`) in a new tab.

### Dashboard

**Dashboard (PDashboard).** Greeting with the clinic name and "All amounts include VAT.", period control (Today, 7 days, 30 days, 12 months). A warn notice appears while any treatment has no booking link ("Setup: 2 treatments have no booking link" + "Add booking links" → Products filtered to missing links). Five stat tiles: Revenue, Orders, Clients, Active members, Redemptions today. Revenue per day chart (→ Shop Summary), Orders by type bars, Recent orders table (→ the client's Orders tab) and Redeemed today list.

**Dashboard · new clinic (PDashboardNew).** "Get your app ready" checklist with progress ("1 of 6 done"): logo and brand color, add treatments and products, **add a booking link to each treatment**, create a reward, set up a membership (optional), share the app (QR code). Each step has one button; done steps show a check and Edit. A live mini preview shows what clients see now. Stat tiles show 0 with an explanation of when they fill.

### Clients

**Clients (PClients).** Count line (clients · members), Export and Add client. Search field and filter chips (All, Members, Not members, Items to redeem) inside the card, sorted by last visit. Columns: Client, Phone, Status, Points, App Cash, Last visit, To redeem. Pagination "Showing 1–8 of N". Row → Client · Account.

**Client header (all client tabs).** Avatar, name, membership badge, client since, contact, "Adjust points"; four tiles (Points, Patient App Cash, Items to redeem, Spent in total); tabs Account / Items / Orders / Membership.

- **Account (PClientAccount)** – personal details form, client number, marketing consent as recorded in the app (read-only, with date), points and App Cash with Adjust buttons (every change logged with a reason), team notes, "Delete client and personal data" (danger, confirm).
- **Items (PClientItems)** – Ready to use / All items, table with type, bought, left and status (READY, COLLECTED, USED). Redeem opens the drawer: choose the item, sessions to use, optional note, a summary of what is left, "Redeem 1 session". The client gets a confirmation in the app.
- **Orders (PClientOrders)** – order number, date, items, payment method (official mark), total incl. VAT, status (PAID, PENDING, REFUNDED) and Receipt.
- **Membership (PClientMembership)** – non-member: explanation that clients join in the app (so they see price, renewal and cancelling) and "Send membership link". Member (to build): plan, next payment, perks used, history.
- **Tablet (PTabletClient)** – the Items tab at 1024 with the collapsed sidebar; used at the desk.

### App Builder

Header "App Builder – Everything your clients see in the app. Changes go live as soon as you save." with the tab's main action on the right. Tabs in this order: **Custom plans, Offers, Products, Membership, Rewards, Settings**.

- **Custom plans (PBuilderCustomPlans, PBuilderCustomPlanEdit)** – session packages any client can buy in the app. See *Custom plans (session packages)* below.
- **Offers (PBuilderOffers)** – list of offers with discount, scope, dates, status (ACTIVE, SCHEDULED, AUTOMATIC) and a "Shown in app" toggle; Personal discounts (birthday). Editor drawer: title, discount, applies to, start and required end date, description, photo with the before/after permission checkbox, live Text check list. "Publish offer" stays disabled while an issue is open ("Fix 1 issue to publish"); Save draft is always possible.
- **Products (PBuilderProducts)** – filter All / Treatments / Products / Gift cards, warn notice when treatments miss a link ("Show them" filters). Table: item (with type and booking-link status), price, member price, In app toggle, Edit. Treatments without a link show a warning badge "Booking link missing". Pricing note (prices incl. VAT, struck price only when it was the lowest of the last 30 days, Popular and New set automatically). Live preview of a product card in the non-member view.
- **Edit treatment (PBuilderProductEdit)** – drawer: type (Treatment / Product / Gift card), name, price incl. VAT, member price, duration, **Booking link (required)** for treatments, description. Empty link shows the error and disables "Save treatment" ("Add the booking link to save"). Products and gift cards hide the field.
- **Membership (PBuilderMembership)** – plan list with members per plan, plan editor (name, price per month incl. VAT, perks), a fixed "Renewal and cancelling" block that cannot be hidden, and the live preview of the membership card.
- **Rewards (PBuilderRewards)** – how clients earn points (summary + Edit → Loyalty rules), rewards table (points, redeemed in the last 30 days, In app toggle), naming hint (never "free").
- **Settings** – opens Settings · General; see below.

### Custom plans (session packages)

A custom plan is a **session package**: a fixed number of sessions for one price, which any client can buy in the app (for example "Hydrafacial 5-pack: 5 sessions for €480, valid 365 days"). It is not tied to one client.

**List (PBuilderCustomPlans).** Header action "New custom plan". Table columns: Package (image, name, number sold, "Transferable" when on), Sessions, Price (total incl. VAT and per session), Valid for (days or "No expiry"), Treatments it covers (with a warning badge when a covered treatment has no booking link), In app toggle, Edit. Info notice explains how the app shows the price per session and the saving.

**Editor (PBuilderCustomPlanEdit).** Drawer, 560 wide. Fields in this order:

| Field | Rule |
| --- | --- |
| Name | Required. Name the treatment, not a medicine or brand (Text check). |
| Description | Required. Text check applies; treatments end with "Results vary per person." |
| Image | JPG or PNG, at least 1200 × 800. Without one, the app uses the `brand-soft` placeholder. |
| Price, incl. VAT | Required, more than 0. |
| Sessions included | Required, whole number, 2 or more. |
| Expires | "After a number of days" (then **Days after purchase**, required, 1 or more) or "No expiry". The end date is fixed at purchase: purchase date + days. |
| Treatments it covers | One or more treatments (products and gift cards can't be picked). Each session can be used for any of them. Treatments without a booking link show "Booking link missing" but can still be picked. |
| Visible in the app | On: clients can see and buy it in the Shop. Off: hidden from the Shop; clients who already bought it keep their sessions. |
| Transferable | On: "The client may give remaining sessions to someone else." Off: the give option is not shown. |

Under the price and sessions the drawer shows what clients will see: "€X per session" and the saving line. Changing price, sessions, expiry or treatments only affects new purchases.

**Price per session and saving.** Per session = price ÷ sessions, rounded to the cent. The saving compares with the cheapest covered treatment **at the price the viewer pays**: the regular price for non-members, the member price for members. Saving = sessions × that price − package price. Show "Save €X" when the package covers one treatment and "Save at least €X" when it covers several. When the saving is €0 or less, show no saving line, tag or text at all. Example (Glow 5, €425, 5 sessions, cheapest covered treatment Chemical peel): non-members see "Save at least €50" (5 × €95.00); members see "Save at least €2.50" (5 × €85.50). The saving is worked out per viewer on every screen (Shop cards and rows, package sheet), never stored on the package.

**In the client app**

- **Shop · Browse (W2Shop):** "Session packages" row with cards: image, saving tag, "N sessions" tag, name, validity and what it covers, total price and price per session. "See all" → Treatments tab, Packages group.
- **Shop · Treatments (W2ShopTreatments):** "Packages" group with rows: name, "N sessions · valid 1 year", total price, price per session, saving.
- **Package detail sheet (W2Package):** tags (saving, Package), name, price, price per session and points, three facts (sessions, validity from purchase, Shareable when transferable), the covered treatments with their single price and "Book online after buying" or "Book at the desk", the saving explanation, "Results vary per person.", Primary "Add to cart €X".
- **Profile → My items (W2Profile):** package card with "3 of 5 sessions left, valid until 2 Oct 2027" and one segment per session. Below it, one row per covered treatment: a "Book" button that opens that treatment's booking link, or "Book at the desk" when it has none. When transferable: "Give sessions to someone".
- **Give sessions (W2GiveSessions):** sheet with the package summary, a stepper for how many sessions (1 to the number left), "Their email or phone number", three facts (they need an account at the same clinic; the sessions arrive in their My items with the same treatments and end date; this can't be undone), what the giver has left, and Primary "Give N session(s)".

**Rules for giving sessions**

- The receiver must have an account in the same clinic's app, found by email or phone. Not found: "We couldn't find an account with this email or phone number at {clinic}." Nothing is sent.
- Sessions move straight away. The receiver gets a notification and a new package entry in My items with the same name, covered treatments and end date. The giver's count goes down.
- A received package can be given on again only if the package is transferable.
- Expired sessions can't be given. Giving to yourself is blocked.
- Every transfer is logged in the Audit log and shows on both clients' Items tab in the portal.

**Redeeming and expiry.** At the desk, staff redeem a package session for any covered treatment from the client's Items tab (the Redeem drawer lists the package with its sessions left). After the end date, unused sessions show as EXPIRED in the portal and move to Past items in the app. The app shows the end date in My items from the day of purchase, and a reminder notification is sent 14 days before it while sessions are left.

### Settings

Second-level navigation on the left with nine sections. Each section has one Primary in the header (Save changes, or the section's add action).

- **General (PSettingsGeneral)** – clinic name, legal name, KvK number, VAT number, client email, phone, website, app language, app address with Copy link.
- **Branding (PSettingsBranding)** – logo upload (SVG or PNG, at least 512 × 512), brand color hex with a live preview of the roles (Scan button, offer tag, member price, banner), optional cover photo.
- **Team (PSettingsTeam)** – people with role (OWNER, MANAGER, STAFF, INVITED), location, last active; Invite team member (drawer); "What each role can do".
- **Locations (PSettingsLocations)** – location cards with address, opening hours, "Shown in app" toggle, Edit; Add location.
- **Loyalty rules (PSettingsLoyaltyRules)** – points per €1 (on the price incl. VAT), member multiplier, points expiry; Patient App Cash expiry and maximum per order; birthday discount.
- **Booking (PSettingsBooking)** – no clinic-wide booking link. Info notice "Booking links are set per treatment" with the count of missing links and "Go to Products". Booking texts used in the app: button text (max. 20 characters), text after payment, text when a treatment has no link; live preview.
- **Notifications (PSettingsNotifications)** – automatic messages with editable text and a toggle each: Reward unlocked, Items ready to redeem, Book your treatment (only for treatments with a link), Membership renews soon (recommended), Offers and news (only to clients who opted in, with the count). Editor for the in-app permission prompt that lists every kind of message, including offers.
- **Integrations (PSettingsIntegrations)** – cards per category (Payments, Accounting, Email newsletter, Website widget) with status and Connect or Manage. Payouts and fees live under Payments.
- **Audit log (PSettingsAuditLog)** – filter chips (All, Clients, Prices, Team, Settings), "Kept for 2 years", Export CSV. Columns When / Who (name and role) / What changed (with where: portal and location).

### Shop Summary

**Shop Summary (PShopSummary).** Period control and Export CSV; tiles Sales, Orders, Average order, Refunds; Sales per day chart; Sales by type; Top items; Payment methods with share per method. All amounts incl. VAT.

## Booking links

Booking happens on the clinic's own booking system. Pirs stores one link per treatment and opens it; it does not take bookings itself.

### Data

| Field | On | Rule |
| --- | --- | --- |
| `booking_url` | Treatment | Required to save a new or edited treatment. Must be `https://`. Opened in the system browser (not inside the installed app, so the client keeps their place). |
| – | Product, gift card, membership | No booking link; the field is not shown |
| Booking texts | Clinic (Settings → Booking) | Button text (max. 20 characters, default "Book appointment"), text after payment, text for treatments without a link |

Existing treatments from before this change can have an empty link. They stay buyable, but are flagged.

### Portal

- **Edit treatment drawer:** "Booking link (required)" with the hint that it opens the clinic's own booking page for this treatment. Empty → error under the field and Save disabled.
- **Products list:** treatments without a link show the warning badge "Booking link missing" in the item cell, plus a warn notice above the table with "Show them" (filters to missing links).
- **Dashboard:** warn notice "Setup: N treatments have no booking link" while N > 0; on a new clinic it is step 3 of the setup checklist.
- **Settings → Booking:** no clinic-wide link any more; only the booking texts and a notice that links are set per treatment.
- **Audit log:** adding or changing a link is logged.

### Client app

| Place | Treatment has a link | Treatment has no link |
| --- | --- | --- |
| Profile → My items | "Book appointment" (black) under the item | No button; "N sessions left · show your code at the desk" |
| Payment result | Next step card "Book your treatment(s)" with **one row and one "Book" button per treatment** in the order | When nothing in the order has a link: "Your items are ready" + "View my items" (grey) leads |
| Buy again (Home) | "Buy again" (outline, adds to cart) + "Book appointment ↗" (black) | "Buy again" only |
| Product sheet and Checkout | Note: "After buying, book your time on {clinic}'s booking page." | No note |
| Notification | "Book your treatment" after purchase (if switched on) | Not sent |

Mixed orders (treatment with link + product or linkless treatment): Book rows for the linked treatments, then one line for the rest ("Hydrating Serum is ready at the desk.").

### Edge cases

- Link removed after purchase: the button disappears and the item falls back to the no-link text.
- Link added after purchase: the button appears on items already bought.
- A session used up (0 left): no Book button.
- Membership perks that include a treatment (e.g. monthly facial) use that treatment's link.
- Session packages show one Book button per covered treatment that has a link, in My items and on the payment result; covered treatments without a link show "Book at the desk".

## Content and compliance rules

These rules apply to all fixed copy and to every text a clinic enters. The portal's Text check enforces the ones marked **(checked)**. This is a design brief, not legal advice; have the final copy reviewed.

### Prices and checkout (EU consumer law)

- All prices include VAT and say so ("All prices include VAT.", "Total incl. VAT"). The full total is shown before the payment step, with "No extra costs" when that is true.
- The final button names the action and the amount: "Pay €132.50", "Pay €79.00 and join".
- A struck-through old price is only shown when it was the lowest price in the 30 days before the discount **(checked)**.
- Urgency only when it is real: an offer shows its actual end date, which is required **(checked)**. No fake countdowns or stock counts.
- "Free" only for things that cost nothing. Rewards are paid with points, so they are never called free **(checked)**.
- Members pay line for non-members: regular price in bold, "Members pay €X →" below.

### Memberships

Every screen where a client can join shows the price per period incl. VAT, that it renews automatically, and how to cancel (Profile → Membership → Cancel membership). Perks run until the end of the paid month. Cancelling takes the same number of steps as joining. A reminder notification before renewal is recommended. Clinics cannot hide these terms.

### Clinic advertising

- No result promises ("guaranteed", "permanent", "pain-free") **(checked)**. Treatment pages say "Results vary per person."
- No prescription medicine names or brand names of such medicines in titles, offers or descriptions **(checked)**. Describe the treatment instead.
- Before/after photos only with the client's written permission (checkbox in the editor) and always with "Results vary per person".
- "Popular" and "New" tags are set from real sales and dates, not by hand.

### Payment and Apple brands

- Use the official names unchanged: **Apple Pay**, **iDEAL | Wero**, **Klarna**, card network names (Visa, Mastercard, American Express). Use the providers' official logo files unaltered, at their minimum size, on white.
- Show Apple Pay only on devices that support it.
- Install instructions use Apple's exact wording: tap **Share**, then **Add to Home Screen**.
- Partner logos in Integrations are the partners' official, unaltered marks.

### Notifications

Before the iPhone permission prompt, the app shows its own screen that lists what clients will get (rewards, items ready, booking reminders, membership renewals, and offers and news from the clinic). Offers and news are only sent to clients who said yes to offers; the consent and its date are stored and visible in the portal.

### Privacy

Clients can see and edit their details; clinics can delete a client and their personal data. Team notes are only visible in the portal. Point and App Cash changes are logged with the staff member and a reason.

### Writing style

Short, plain, second person ("Your items are ready"). Sentence case. Name things the same everywhere: Patient App Cash, My items, Book appointment, Buy again, View my items.

## Assets to supply and open questions

### Assets to supply

| Asset | Source | Where |
| --- | --- | --- |
| Hanken Grotesk (400–800) | Google Fonts, self-host the woff2 files | Both apps |
| Apple Pay mark and button | Apple Pay developer resources | Payment rows, Shop Summary, Orders |
| iDEAL \| Wero mark | iDEAL / Wero brand portal | Payment rows, Orders |
| Klarna badge | Klarna brand portal | Payment rows, Orders |
| Card network marks | Visa, Mastercard, American Express brand sites | Payment rows |
| Partner logos | Each integration partner | Settings → Integrations |
| Icon set (24 grid, 1.9–2.2 stroke, round caps) | Paths on the canvas boards (V2Foundations, V2Nav) | Both apps |
| App icon and splash per clinic | Generated from the clinic logo and brand color | Add to Home Screen |
| Example photos | Placeholders only; clinics upload their own | Products, offers, cover |

On the canvas, every "Logo" slot marks where an official mark goes. Don't redraw marks.

### Open questions

1. **Integrations** – which partners are live (payments provider, accounting, newsletter, website widget)? The cards are generic categories for now.
2. **Member views** – Profile · Membership and Client · Membership are drawn for non-members; the member state is described above and needs a board if you want it designed in detail.
3. **Search** – the top bar has no global search (per the real structure). Confirm that client search on the Clients page and in the Redeem picker is enough.
4. **Result rows** – the result screen uses the short label "Book" per row and "Book appointment" elsewhere. Confirm, or use the clinic's button text everywhere.
5. **Booking link format** – should the portal check that a link opens (HEAD request) when saving, or only that it is a valid `https://` address?
6. **Payouts** – Shop Summary points to Settings → Integrations → Payments for payouts and fees. Confirm that is where they live.
