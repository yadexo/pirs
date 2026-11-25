# Functional QA — bug hunt, November 2026

**Date:** 24 November 2026 · **Build:** `main` at `9f6b6e4`, production build via `npm run serve`
**Data:** the seeded local database (Riverside Wellness Clinic) plus test records created during the pass and removed afterwards
**Device:** Claude's built-in browser at iPhone width, 390 × 844, Dutch (nl) unless stated
**Scope:** functional bugs only — not security. No code was changed.

## How to read this

Severity:

- **Blocks a clinic** — a clinic cannot do a basic job, or a client is harmed (charged, misled) in a way the clinic will have to clean up.
- **Annoying** — works, but looks broken, misleads, or costs every user extra steps.
- **Cosmetic** — visible imperfection with no functional cost.

Each bug has an ID (prefix = screen), exact steps, expected vs actual, the file and line where the cause was found, and a suggested fix. "Code-confirmed" means the behaviour was traced in the source but could not be fully driven in the test browser.

What could **not** be tested here, and why:

- **Real card payments.** There are no Stripe keys locally, so checkout uses the mock provider. The Stripe card form, 3-D Secure and webhooks were not exercised.
- **Camera QR scanning.** The camera is blocked in the test browser; redeem-by-code was tested instead.
- **Signed-in pages on a white-label domain, visually.** The test browser blocks scripts and styles on unapproved hosts. Clinic-domain routing, links, manifest and assets were checked by request with `x-forwarded-host` instead.
- **Real push and email delivery.** Locally these go to the mock provider; the log lines were checked.
- **Slow network.** Simulated by delaying `fetch` by 2.5–4 s in the page (server actions use it), not by real network throttling.

---

## Five bugs a first real clinic would hit first

These are at the end of the report as requested, but repeated here so they are not missed:

1. **PK1 — Packages cannot be created or edited.**
2. **AB1 — Product and treatment photos cannot be uploaded.**
3. **PT1 — "Verzilveren" (redeem) is unreachable on a phone,** and **SO1 — staff cannot sign out** below 1200 px.
4. **H1–H3, S2, R1 — The Dutch client app shows English and English-formatted money** on the home and shop screens.
5. **X1 — Deleting a client account does not cancel their membership.**

Details and reasoning are in the last section.

---

## Client app

### Sign-up and sign-in

**C1 — Sign-up validation messages are English on a Dutch page** · Annoying
- **Steps:** open `/app/riverside-wellness` → "Account aanmaken" → fill all fields, password "short" → submit.
- **Expected:** a Dutch message.
- **Actual:** "Password must be at least 8 characters". "First name is required" and "Enter a valid email" behave the same way.
- **Where:** `lib/actions/auth.ts:157-163` (`registerSchema` messages are English literals).
- **Fix:** return message keys from the schema and translate them with `getTranslations("auth")`.

**C2 / D3 — Every server error empties the form** · Annoying
- **Steps:**
  - sign-up with a too-short password → all four fields are empty afterwards;
  - sign-in with a wrong password → the email field is empty.
- **Expected:** typed values stay; only the password may be cleared.
- **Where:** `app/app/[merchantSlug]/onboarding.tsx:74-77, 97-100` — `useActionState` with uncontrolled inputs, which React 19 resets after every action.
- **Fix:** keep the fields in state (as `app/login/login-form.tsx` already does), or echo the submitted values back as `defaultValue`.

**C3 — Password rules only appear after a round trip** · Cosmetic
- **Actual:** the sign-up password field has no hint and no `minLength`.
- **Fix:** show "Minstens 8 tekens" under the field and add `minLength={8}`.

**C4 — No language switch on the client sign-in or sign-up screen** · Annoying
- **Actual:** an English-speaking client of a Dutch clinic cannot switch before signing in. The forgot-password page does have the switch (`GuestLocaleSwitcher`).
- **Fix:** add `GuestLocaleSwitcher` to the onboarding screen.

**C5 — Inputs are placeholder-only** · Cosmetic
- **Actual:** once typing starts, nothing says which field is which.
- **Fix:** visible labels, or floating labels.

**D1 — Signing in from a deep link loses the destination** · Annoying
- **Steps:** while signed out, open `/app/riverside-wellness/profile?tab=settings` (or any link from an email, such as `/profile?tab=membership`) → sign in.
- **Expected:** land on that page.
- **Actual:** land on the app home.
- **Where:** `onboarding.tsx` sends no `next`; `lib/actions/auth.ts:79` falls back to the base path.
- **Fix:** add a hidden `next` field with the current path and query (`safeNext` already validates it).

**D4 — "Email and password are required." in English** · Cosmetic — `lib/actions/auth.ts:80`.

**D5 / W2 — The browser tab says "Clinic Engagement Platform" on clinic-branded pages** · Annoying (white-label)
- **Steps:** "Wachtwoord vergeten?" from the client app; also on the clinic's own domain.
- **Expected:** the clinic's name in the tab.
- **Actual:** the platform's generic title. The address typed at sign-in is also not carried over to the reset form.
- **Where:** `app/layout.tsx:81-84` (static `metadata`).
- **Fix:** `generateMetadata` on `/forgot-password` and `/set-password` using the clinic (from `x-clinic-host` or `?clinic=`); pass the email along as a query value.

### Home

**H1 — "NOT A MEMBER" in English on the Dutch home screen** · Annoying
- **Steps:** sign in as a non-member, view home.
- **Actual:** the chip reads "NOT A MEMBER", while the profile shows "GEEN LID" for the same state.
- **Where:** `lib/client-app-home.ts:120` hard-codes it; the key `notAMember` exists in `messages/*.json` but isn't used there.
- **Fix:** return `null` and render `t("notAMember")` in `home-view.tsx`.

**H2 — "Members pay €108 →" and the "MEMBER" tag are English on every card** · Annoying
- **Where:** `components/client-app/v2.tsx:184, 189, 192`.
- **Fix:** translate them, e.g. "Leden betalen {price} →".

**H3 / S3 / K4 — Money is in English format in the Dutch app, mixed with Dutch format on the same screen** · Annoying
- **Steps:** home or shop in NL.
- **Actual:**
  - cards and pay buttons: "€120", "€76.50", "Afrekenen €126.50";
  - balance, packages, search and totals: "€ 0", "€ 1.100", "€ 126,50".
- **Where:** `components/client-app/ui.tsx:76` — `money()` defaults to `"en"`; `v2.tsx:53, 182, 183, 189` and the pay buttons call it without a locale.
- **Fix:** take the locale from `useLocale()` inside `money()`, or make the parameter required.

**H4 — Large empty grey block on home when the clinic has no cover image** · Cosmetic
- **Fix:** collapse the hero or use a brand-colour gradient when there is no image.

### Shop

**S1 — Package savings are understated for every non-member** · Annoying
- **Steps:** as a non-member, open Shop → Behandelingen → Pakketten.
- **Expected:**
  - "5-Session Physical Therapy Pack" (€650, singles €150): "Bespaar € 100";
  - "10-Session Acupuncture Pack" (€1.100, singles €125): "Bespaar € 150".
- **Actual:** both say "Bespaar € 25".
- **Where:** `lib/client-app-catalog.ts:257` uses `t.memberPriceCents ?? t.viewerPriceCents`. For a non-member, `memberPriceCents` is the *member* teaser price (`lib/merchandising.ts:83`), so the comparison uses the price the viewer does not pay.
- **Fix:** `singlePriceCents: t.viewerPriceCents`.

**S2 — "New" and "Popular" badges are English** · Annoying
- **Where:** `lib/merchandising.ts:59-60`.
- **Fix:** return a kind (`"new" | "popular"`) and translate it in the card.

**S4 — The Filter button doesn't show that a filter is active** · Cosmetic
- **Steps:** Behandelingen → Filter → "Onder € 50" → Toepassen.
- **Actual:** the list is empty and the button looks unchanged.
- **Fix:** show a count or dot when filters are set.

**S5 — The "Populaire behandelingen" row starts flush at the screen edge** while headings are inset · Cosmetic.

**M2 — Banner "Leden besparen 10% op alles" when the plan only discounts treatments** · Annoying (misleading price claim)
- **Steps:** non-member → Shop → banner. Wellness Essentials has `serviceDiscountPercent: 10` and no product discount.
- **Actual:** the banner claims 10% off everything.
- **Where:** `app/app/[merchantSlug]/shop/shop-view.tsx:255` takes `max(service, product)`; `messages/nl.json:475` says "op alles".
- **Fix:** separate wordings for "op behandelingen" / "op producten" / "op alles" depending on which discounts are set.

**Accessibility** (cosmetic): the "+" buttons are labelled "Add <name>" and the cart controls "Close", "Decrease", "Increase" — English for screen readers on the Dutch app (K5).

### Cart and checkout

**M1 — For members, the cart total doesn't add up** · Annoying
- **Steps:** member with €20 credit → cart with Nutrition Consultation (€85) and 2 × Foam Roller (€35).
- **Expected:** a credit line explaining the difference.
- **Actual:** the lines come to €146,50 (85 + 70 − 8,50), but "Totaal incl. btw € 126,50", with no credit line on the cart step.
- **Where:** `app/app/[merchantSlug]/cart-sheet.tsx:133` subtracts the credit for both steps; the credit toggle and line are only rendered on the checkout step (`:279-288`, `:333-337`).
- **Fix:** show the credit line on the cart step too, or don't apply credit until checkout.

**X5 — Floating cart bar total disagrees with the cart** · Annoying
- **Actual:** "Bekijk winkelmandje · 3 items €155" while the cart says "€ 126,50". The bar shows the sum before the member price and credit.
- **Fix:** use the same `cartTotals()` result.

**K2 — "Bekijk mijn items" after payment seems to do nothing** · Annoying
- **Steps:** pay → "Betaling voltooid" → "Bekijk mijn items".
- **Actual:** the URL changes to `/profile?tab=items`, but the success sheet stays open on top.
- **Fix:** close the sheet before `router.push`.

**K1 — After a mock payment, "Je items zijn klaar" leads to an empty Mijn items** · Annoying (local, demo and Stripe-less staging only)
- **Where:** the mock settle path `lib/actions/client-app.ts:870` calls `completePaidOrder` but not `createItemsForOrder` / `createPackagesForOrder`. The credit-only path (`:792-794`) and the Stripe webhook (`lib/stripe-webhook.ts:368`) do both.
- **Fix:** call both after `completePaidOrder` in the mock path. This also makes redeem testable end to end without Stripe.

**K3 — A cart line shows the unit price ("€ 35") next to quantity 2,** with no line total · Cosmetic.

**K6 — No visible remove button** (only swipe, or "−" at quantity 1) · Cosmetic.

**K7 — The email address wraps at its hyphen on the success sheet** · Cosmetic.

**N1 / N2 — Slow network: add-to-cart gives no feedback, and taps can be lost** · Annoying
- **Steps:** delay `fetch` by 2.5–4 s and tap "+".
- **Actual:**
  - the button is not disabled and shows no spinner for the whole wait;
  - in one run, two quick taps added nothing and showed no message;
  - on a retry, two taps added one item.
- **Fix:** disable the button and show pending per item; show the action's error if it fails.

### Profile: orders, receipt, appointments

**P1 — The "Afspraken" sheet lists orders** · Annoying
- **Steps:** Profiel → Mijn items → Afspraken.
- **Actual:** "Follow-up Consultation +1 · BETAALD · Bon bekijken" — a paid order, duplicating "Bestellingen en bonnen".
- **Where:** `app/app/[merchantSlug]/profile/profile-view.tsx:257-277`.
- **Fix:** only appointments in that sheet.

**P2 — Appointment status is shown as the raw value** · Annoying
- **Actual:** "REQUESTED", "COMPLETED", in English capitals.
- **Where:** `profile-view.tsx:236` `{a.status}`.
- **Fix:** translate each status.

**P3 — Every order is labelled "Betaald",** including refunded ones · Annoying (code-confirmed)
- **Where:** `profile-view.tsx:273` hard-codes `tp("paid")`.
- **Fix:** derive the label from the order status, including partial and full refunds.

**P4 — The receipt ("Bon") has no line prices, no btw and no status** · Annoying
- **Actual:** only the items, date, total and points. Clients who need a receipt for their insurer will ask the clinic.
- **Fix:** show line amounts, btw, and the payment and refund status.

**P5 / T2 — Dates are in English form on the Dutch app** · Cosmetic
- **Actual:** "24 Nov 2026", "10 Sept" (Dutch: "24 nov. 2026", "10 sep").
- **Fix:** format with the active locale.

**P6 — Stale requests** · Annoying
- **Actual:** an appointment requested for 8 Nov is still "REQUESTED" two weeks later. Nothing expires or flags past requests.

**P7 — "Mijn items" empty state has no button to the shop** · Cosmetic.

### Rewards and scan

**R1 — The whole "Sneller verdienen" list is English** · Annoying
- **Actual:** "Refer a friend", "+100 Points", "Purchase in-app", "1 point per €1 spent", "Visit our clinic", "Birthday bonus".
- **Where:** `lib/client-app-data.ts:144-162`.
- **Fix:** return keys plus numbers and translate them in the view.

**R2 — Reward name and cost run together:** "$5 off your order100 pt" · Cosmetic.

**R3 — The "Scannen" tab shows the client's own code;** the client never scans · Cosmetic. Consider "Mijn code".

(Not a bug: the points number counts up from 0 on load; a screenshot mid-animation showed 20 instead of 95.)

### Account and settings

**X1 — Deleting the account does not cancel the membership** · **Blocks a clinic**
- **Steps:** client with an active membership → Profiel → Account → Account verwijderen → type DELETE → confirm.
- **Expected:** the membership and Stripe subscription are cancelled, or the client is told to cancel first.
- **Actual:**
  - the user is set to DISABLED, but the membership stays ACTIVE (checked in the database);
  - the client keeps being charged and can no longer sign in to cancel;
  - the portal keeps counting them in "Totaal actieve leden" (MB2).
- **Where:** `lib/actions/client-app.ts:1707-1737` (`clientDeleteAccountAction`).
- **Fix:** cancel active memberships (Stripe `cancelSubscription`) in the same action, and say so in the confirmation text.
- **What happens on closure, as fixed in round 1** (decisions D1–D5; **to be confirmed by the lawyer**):
  - any membership that could still bill is cancelled immediately on Stripe, and nothing more is charged;
  - the current period is **not refunded**; the clinic can still refund manually from the portal;
  - **prepaid credit, unused items and unused package sessions lapse** with the account and are not paid out. The confirmation text tells the client this and suggests contacting the clinic first;
  - treatment and payment history stays with the clinic where the law requires it;
  - one last service email confirms the closure.

**X2 — "Account verwijderen" and "Uitloggen" are covered by the floating cart bar** · Annoying
- **Steps:** have something in the cart → Profiel → Account → scroll to the bottom → tap "Account verwijderen".
- **Actual:** the cart opens. The bar covers the last rows of every page.
- **Where:** `app/app/[merchantSlug]/client-app.css:198` — `.ca-scroll` reserves only the tab-bar height.
- **Fix:** add the cart bar's height to the padding while the bar is shown.

**X3 — Account deletion requires typing English "DELETE", case-sensitively** · Annoying
- **Actual:** "delete" or "Delete" (which phones produce by auto-capitalising) leave the button disabled with no hint.
- **Fix:** accept a Dutch word ("VERWIJDEREN"), compare case-insensitively, and show a hint.

**X4 — No confirmation after deletion;** silently back to sign-in · Cosmetic.

**A1 — "Notifications blocked" help always gives iPhone steps,** on Android and desktop too · Annoying
- **Where:** `components/client-app/push.tsx:291, 314, 349` use `deniedSteps` without a platform check.
- **Fix:** separate texts for iOS, Android and desktop (the install nudge already detects the platform).

**A2 — Clients can opt into SMS, but SMS never sends** · Annoying
- **Where:** `lib/providers/notifications/sms.ts` is a stub.
- **Fix:** hide the SMS option until an SMS provider exists.

**A3 — Notification channels look like radio buttons,** though they're independent switches; the title is repeated as a section heading · Cosmetic.

**A4 — "Contact met de kliniek" has no phone number, email or button** · Annoying
- **Fix:** show the clinic's phone and email with call and mail links.

**A5 — Account rows have no accessible names** (screen readers) · Cosmetic.

**D2 — Browser or Android Back with a sheet open leaves the page** instead of closing the sheet · Annoying
- **Steps:** Beloningen → "Hoe het werkt" → Back → previous page.
- **Fix:** push a history entry when a sheet opens and close the sheet on `popstate`.

### Clinic's own domain (white-label)

- **Checked by request** with `x-forwarded-host` mapped to Riverside:
  - app pages, manifest (`start_url "/"`), service worker, icons, launch images and uploads load;
  - login, portal, admin, register and account return 404;
  - old `/app/<slug>` links redirect;
  - no in-page link points to `/app/<slug>` or `/login`.
- **W1 — `/favicon.ico` and `/apple-touch-icon.png` are 404 on every host** · Cosmetic
  - portal, admin and sign-in pages show a blank tab icon and log a 404 on each load;
  - **fix:** add `app/icon.png` / `favicon.ico`.
- **SO3 / AD8 — Refused paths, and a suspended clinic, show Next's default black English 404** · Annoying (white-label). See the portal section.
- Signed-in clinic-domain pages could not be driven visually here (see "What could not be tested").

---

## Clinic portal

Signed in as the seeded owner, then as a new Front Desk member.

### Phone layout in general

**PT1 — "Verzilveren" (redeem) cannot be reached on a phone** · **Blocks a clinic**
- **Steps:** any portal page at 390 px wide.
- **Expected:** Verzilveren, QR scannen and App bekijken all reachable.
- **Actual:** "Verzilveren" sits at x −59…71, entirely under the 84 px sidebar or off-screen; "QR scannen" is clipped. Redeem-by-code, the front desk's main action, is unreachable on a phone.
- **Where:** `app/globals.css:317-324` — `.pk-topbar` is `justify-content: flex-end` with 40 px padding; the only breakpoint is ≤ 1199 px (`:349`). The three buttons need about 600 px.
- **Fix:** below about 640 px, wrap the bar, use icon-only buttons, or move Verzilveren into a bottom action.

**SO1 — Staff cannot sign out below 1200 px** · Annoying (shared front-desk devices)
- **Steps:** portal on a phone or tablet → look for sign out.
- **Actual:** the sign-out button is `display: none` and the avatar isn't a button.
- **Where:** `app/globals.css:304` (`.pk-user .out` inside the ≤ 1199 px rule); `components/shell/sidebar.tsx:110-123`.
- **Fix:** make the avatar open a small menu with "Uitloggen", or keep the button visible.

**SO2 — `/logout` is a 404** (it's in `RESERVED_SLUGS` but has no page) · Cosmetic.

**SO3 — There's no custom 404 page anywhere** · Annoying (white-label)
- **Actual:** Next's default black, English "404 | This page could not be found.". Clients see it on a clinic's own domain for refused paths and for a suspended clinic (AD8).
- **Fix:** `app/not-found.tsx` that uses the clinic's branding when `x-clinic-host` is set, plus a Dutch text.

**SO4 — The sidebar shows the raw role** ("TENANT_ADMIN", "PLATFORM_ADMIN") under the name on wide screens · Cosmetic — `components/shell/sidebar.tsx:116`.

**PD4 — The portal keeps the 84 px icon sidebar on a phone,** with no mobile navigation, leaving about 300 px for content · Annoying.

### Dashboard

**PD1 — The booking-link warning is unreadable on a phone** · Annoying (the first card an owner sees)
- **Steps:** owner dashboard at 390 px.
- **Actual:** "13 behandelingen hebben geen boekingslink…" wraps one word per line, because "Boekingslinks toevoegen" stays beside it.
- **Where:** `app/m/[merchantId]/page.tsx:63-77` (`.pk-notice` row with a `shrink-0` button).
- **Fix:** stack the button under the text below about 640 px.

**PD2 — A Dutch sentence lists items with English "and"** · Annoying
- **Actual:** "…Acupuncture Session and Chiropractic Adjustment kopen…".
- **Where:** `page.tsx:69` `.join(" and ")`.
- **Fix:** `Intl.ListFormat(locale)`.

**PD3 — The activity feed is English** · Annoying
- **Actual:** "Joined the app", "Paid for order ORD-…", "Joined Wellness Essentials".
- **Where:** summaries are stored as English text (`lib/actions/auth.ts:290`, `lib/order-completion.ts:83`, …).
- **Fix:** store an event type with parameters, and render with `t()`.

**PD5 / AD9 — Dashboard labels and empty states are English** · Annoying
- **Actual:** "Treatments", "Products", "Memberships", "Custom plans", and "No data available" six times. This is the first screen a brand-new clinic sees.

**SH1 / MB1 — Revenue tiles are clipped on a phone** · Annoying
- **Actual:** "€798.56" and "€79.86" on the shop overview, "€ 246,00" on memberships — partly hidden under the tile's icon.
- **Fix:** let the number wrap, or put the icon above it at narrow widths.

### Clients and redeem

**PT2 — The client list is a 950 px sideways-scrolling table on a phone;** names and numbers wrap over three lines · Annoying.
- **Fix:** a card list below about 640 px.

**RD1 — The redeem dialog shows the raw status** ("available", "redeemed") · Annoying — `components/merchant/redeem.tsx:215`.

**RD2 — Redeem dialog dates: browser locale and the wrong time zone** · Annoying
- **Steps:** redeem an item by code, then look it up again.
- **Actual:**
  - "Gekocht 11/24/2026";
  - "Al verzilverd op 11/24/2026, 5:15:24 PM" for a clinic in America/Chicago, where it was 10:15. The portal's own "Recente verzilveringen" shows 10:15 correctly.
- **Where:**
  - `redeem.tsx:201-202` use `toLocale*(undefined, …)`;
  - the top bar (`MerchantShell`) is rendered outside `ClinicTimeZoneProvider` (`app/m/[merchantId]/layout.tsx:35`), so `useClinicTimeZone()` falls back to `DEFAULT_TIME_ZONE` (Amsterdam) for every clinic.
- **Fix:** move the provider around `MerchantShell` and format with the portal locale.

**RD3 — "Gekocht" (bought) shown for an item the clinic gave away** · Cosmetic.

**RD4 — Client drawer** · Cosmetic
- **Actual:** credit shows "€0.00"; the tab row is cut off ("Ber…"); "Gegeven op 24-11-2026" while other screens say "24 nov 2026".

Worked: issuing an item; code lookup is case-insensitive; redeem; a second redeem is refused with who and when.

### Shop overview and refunds

**SH3 — The refund dialog is right-aligned** · Cosmetic (looks broken)
- **Actual:** it's rendered inside the table cell (`<td>` with `text-align: right`), so title, description, labels and help text are all right-aligned.
- **Fix:** render the dialog in a portal, or reset `text-align`.

**SH2 / PT4 / AB5 / PK4 / ST4 — English money format in the portal** · Annoying (PK4) / Cosmetic (the rest)
- **Actual:** "€95.00", "€125.00", "€110.00 per sessie", "€29.95", and **"€1,100.00"** — which a Dutch owner reads as €1,10. Other portal screens show "€ 95,00".
- **Where:** `formatMoney()` in `lib/utils.ts:9` defaults to `en-US`; for example `catalog-tab.tsx:342` calls it without a locale.
- **Fix:** pass the portal locale everywhere, or default it.

**SH4 — Refund placeholder "25.00" uses a decimal point** · Cosmetic. (A typed "10,50" is accepted correctly.)

**SH5 — No confirmation after a refund** · Cosmetic.

**SH6 — The order row still shows €95.00 after a €10.50 refund** · Cosmetic.

Worked: partial refund with a Dutch decimal comma; the status becomes "Deels terugbetaald".

### App Builder — products and treatments

**AB1 — Photos cannot be uploaded to products or treatments** · **Blocks a clinic**
- **Steps:** App Builder → Producten → Product maken → Behandeling → fill the form → Afbeelding "Toevoegen" → choose a photo → "Deze uitsnede gebruiken".
- **Expected:** the cropped photo uploads and appears in the form; the product saves with it.
- **Actual:**
  - "Deze uitsnede gebruiken" **submits the product form**: a new treatment was saved at that moment with `imageUrl = null` and the drawer closed;
  - on an existing product the drawer closed and nothing changed;
  - "Annuleren", "Liggend" and "Vierkant" in the cropper are submit buttons too.
- **Where:**
  - `components/merchant/form.tsx:441` renders `<ImageCrop>` inside the form;
  - `components/merchant/image-crop.tsx:118-165` uses `<Button>` without `type`;
  - `components/ui/button.tsx:35-52` has no default `type`;
  - present since `9a73a51` (30 October).
- **Fix:** default `type="button"` in `Button` (an explicit `type="submit"` where a form submits), and/or render the cropper in a portal outside the form.

**AB2 — The product list is unreadable on a phone** · Annoying
- **Actual:** the name column is 0 px wide; "Zichtbaar" sits off-screen at x = 413.
- **Where:** `app/m/[merchantId]/app-builder/catalog-tab.tsx:336-344` (the right-hand group is `shrink-0`).
- **Fix:** let the right group wrap under the name below about 640 px.

**AB3 — Booking-link texts are English** · Annoying
- **Actual:**
  - the "Booking link missing" badge (`app-builder/page.tsx:171, 245`);
  - the "Booking link" field label and hint (`product-form.tsx:459-467` — deliberately pinned in English by `tests/booking-links.test.ts`);
  - the error "Add the booking link to save." (`lib/actions/app-builder.ts:421-422`).

**AB4 — Every treatment requires an external booking link** · Annoying (product decision)
- **Actual:** a clinic with no online booking page (walk-ins, phone) cannot add a treatment without a placeholder URL. For a clinic with in-app bookings on, the requirement contradicts the in-app booking.
- **Where:** `product-form.tsx:466` (`required`), `app-builder.ts:421`.

**AB6 — The App Builder tab strip runs underneath "App bekijken" on a phone** · Cosmetic.

Worked: a Dutch price "49,95" is stored as 4995 cents; the cropper fits a phone screen.

### App Builder — packages

**PK1 — Packages cannot be created or edited** · **Blocks a clinic**
- **Steps:** App Builder → Aangepaste pakketten → "Aangepast pakket maken" → name, price, sessions, tick any treatment → save.
- **Expected:** the package is created.
- **Actual:** "Choose treatments from this clinic" (in English). Editing an existing package fails the same way.
- **Where:**
  - the checkboxes have no `value`: `CheckboxField` (`components/merchant/form.tsx:156-180`) has no `value` prop, and `item-forms.tsx:142-155` uses it with `name="serviceIds"`;
  - so the form submits `serviceIds = ["on"]`;
  - `lib/actions/app-builder.ts:585-590` finds 0 matching treatments and refuses.
- **Fix:** add a `value` prop to `CheckboxField` and pass `value={s.id}`. Worth a test that drives the real form.

**PK2 — Dutch amounts with a thousands dot are refused, in English** · Annoying
- **Actual:** "1.299,50" → "Enter an amount like 49 or 49.50", plus a "Please fix the highlighted fields." banner. "1299,50" is accepted.
- **Fix:** strip thousands separators in `moneyToCents` (`lib/merchant-action.ts:151`) and translate both messages.

**PK3 / AD6 — Form drawers are wider than the screen** · Annoying
- **Actual:** the package drawer is 423 px and "Add merchant" 520 px on a 390 px screen; the right column and the close ✕ are cut off.
- **Fix:** `w-full max-w-[520px]` on the drawer.

**PK5 — The submit button reads "aangepast pakket maken"** (lowercase) · Cosmetic.

### Memberships, offers, campaigns, notifications

Worked:
- **Membership plan:** "29,95" → 2995, credit "5,50" → 550, discount and benefits saved.
- **Offer:** saved, with its end date (31-12 23:59) stored correctly in the clinic's zone.
- **Broadcast:** "Nu versturen" is disabled, with a clear explanation, while no client has notifications on.

**OF1 — An ended offer shows "beëindigd" and "Zichtbaar" together** · Cosmetic.

**CA1 — Campaigns** · Annoying
- **Actual:** the list shows raw values ("IN_APP · DRAFT", "EMAIL · SENT"). Rows can't be opened (`catalog-tab.tsx:332-333`), and there's no button to create a campaign in that view.

**NO1 — Two notification toggles do nothing** · Annoying
- **Actual:** "Een boeking wordt bevestigd…" and "Een afspraak nadert" are offered, but nothing in the code sends booking confirmations or appointment reminders. The clinic believes reminders go out.
- **Fix:** hide them until those messages exist, or build them.

### Team and limited staff

**TM1 — The staff invitation email is plain English text** · Annoying
- **Actual:** "Hi …, You've been added to the team at …", with no translation and no branding. Every other email is a branded NL/EN template.
- **Where:** `lib/actions/clinic-settings.ts:279-289`.

**TM2 — "Medewerker uitnodigen" wraps over the "MENSEN" label on a phone** · Cosmetic.

**TM3 — Setting a new password can land in someone else's account** · Annoying
- **Steps:** on a device where someone else is signed in, a new staff member uses their invite link and saves a password.
- **Actual:** `/login?reason=password-updated` forwards them into the other person's portal (here, the owner's), with no message.
- **Fix:** sign out the current staff session before the redirect, or show "Je bent ingelogd als …".

**ST1 — Limited staff see every screen and button** · Annoying
- **Steps:** sign in as Front Desk (view customers, appointments, sales, messages).
- **Actual:** App Builder, Team, Settings, the audit log and revenue are all shown. Create buttons ("Lidmaatschap maken") look normal and only refuse after a tap.
- **Fix:** hide or disable by permission; decide whether Front Desk should see revenue.

**ST2 — The refusal is English** · Annoying — "You don't have access to do that."

**ST3 — The first refused tap showed nothing;** the toast only came on a second tap · Cosmetic.

**PT3 — Other English in the portal** · Annoying
- **Actual:**
  - "Orders" and "Status" headings on the shop page;
  - role permissions such as "View customers, Manage appointments, Adjust loyalty points";
  - the audit log shows "settings branding updated" and "Requested by client from the client app".

---

## Admin console

Worked:
- creating a clinic by invitation (welcome email logged);
- inviting an admin (one-time 24 h link);
- suspending and reactivating a clinic;
- impersonation and stopping it;
- the in-app bookings switch. Off: no Afspraken and no Book in the client app, no Appointments in the portal, `/appointments` redirects. On: everything returns.

**AD1 — Impersonating breaks the portal layout at every width** · Annoying
- **Steps:** /agency → "Open Riverside Wellness Clinic".
- **Actual:**
  - the "Bekijken als … · Afsluiten" banner becomes a 306 px-wide column as tall as the page;
  - the page is 676 px wide on a 390 px phone;
  - the "Afsluiten" (stop) button sits about 2,330 px down.
- **Where:** `components/shell/app-shell.tsx:110` renders the banner as the first child of the row-flex `.pk-shell` (`app/globals.css:116-120`).
- **Fix:** render the banner above the shell (full-width, sticky), outside the flex row.

**AD2 — The clinic list overflows on a phone** · Annoying
- **Actual:**
  - the page scrolls sideways (537 px);
  - "Active" is clipped to "ctive";
  - the active switch shows no knob;
  - "To Verify" wraps;
  - the Open, Delete and settings buttons are off-screen.

**AD3 — The suspend switch has no label,** and uses the browser's own `window.confirm` · Cosmetic (accessibility)
- **Where:** `app/agency/merchant-list.tsx:154`.
- **Fix:** add an `aria-label`, and an in-app confirm dialog in the clinic's tone.

**AD4 — The membership fee field is easy to leave unsaved, and refuses a Dutch decimal** · Annoying (code-confirmed)
- **Actual:**
  - it saves only on blur or Enter, with no save button;
  - "5,5" is parsed with `Number()`, which gives NaN, and is refused with an English toast.
- **Where:** `app/agency/merchant-list.tsx:196-199`.
- The test browser could not deliver the blur, so no save was observed either way.

**AD5 — The admin console is English while the page says Dutch** · Cosmetic
- **Actual:**
  - the greeting is "Welcome back, platform-admin@example.com! 👋" (by email address);
  - Settings mixes English with a Dutch "Tweestapsverificatie resetten" block;
  - dates read "Nov 24, 2026";
  - clinics are called "Merchants".

**AD6 — "Add merchant"** · Annoying
- **Actual:** the drawer overflows the screen (see PK3); there's no language choice for the new clinic (self-registration has one); only three time zones are offered.

**AD7 — A "Ctrl+K" shortcut hint is shown on a phone** · Cosmetic.

**AD8 — A suspended clinic's clients get the bare default 404,** not a "temporarily unavailable" message · Annoying.

---

## Demo data (seed) — not product bugs, but they mislead demos

- Riverside is seeded with euros, Dutch as default and Dutch text, but with:
  - the time zone America/Chicago (`prisma/seed.ts:78`), so appointments appear at 03:30 and 08:00;
  - a US address;
  - rewards named "$5 off your order".

  New clinics correctly default to Europe/Amsterdam (`lib/actions/register.ts:128`, `lib/actions/merchants.ts:22`).
- The seed creates no redeemable items, so "Mijn items" is empty for every seeded client.
- Seeded orders from October are still "In behandeling" (pending).

## Checked and working

- **Sign-up, sign-in, sign-out:** the wrong-password message is Dutch.
- **Password reset:** the request logs `[reset] outcome=sent`.
- **Language switch:** NL → EN → NL takes effect immediately, and English pages had no Dutch leftovers.
- **Shop:** search with a correct no-results state; filter with a correct empty state.
- **Cart:** add, change quantity, remove and empty state; totals and 21% btw arithmetic.
- **Mock checkout:** order number and points earned.
- **Membership:** joining (mock) gives the member state, price and credit.
- **Notifications:** preferences persist after reload.
- **Time zones:**
  - portal greeting and activity-feed times;
  - offer end dates;
  - "Recente verzilveringen".
- **Portal:** all 21 routes load, none with "something went wrong"; issuing and redeeming an item, and refusing a second redeem.
- **Refunds:** partial refund with a Dutch comma.
- **Plans and offers:** membership plan and offer creation.
- **Team:** staff invitation and its set-password page.
- **Admin:** clinic invitation, admin invitation, suspend and reactivate, impersonation and stopping it, the in-app bookings switch both ways.
- **White-label domain:** routing and links (see that section).

## Clean-up

Everything created during this pass was removed from the local database:
- the test client, staff member, admin and clinic;
- the test treatment, plan, offer and item;
- the test domain;
- orders and related rows.

The two seeded accounts' two-factor secrets were temporarily set to the test fixture's known value for sign-in and then restored. Riverside is left with in-app bookings on. No code was changed.

---

## The five bugs a first real clinic would hit first

In the order a new clinic meets them:

1. **PK1 — Packages cannot be created or edited** (blocks).
   - Setting up the catalogue is the first thing a clinic does, and session packages are a core product.
   - Every attempt fails with an English "Choose treatments from this clinic", whatever is ticked.
   - The fix is one prop: `value={s.id}`.
2. **AB1 — Product and treatment photos cannot be uploaded** (blocks).
   - The next step of the same setup: confirming the crop saves the product without the photo and closes the form.
   - A shop without photos looks unfinished to the clinic's clients.
   - The fix is one line: a non-submit button type.
3. **PT1 (with SO1) — At the desk on a phone, there is no Redeem button and no way to sign out** (blocks).
   - The first time a client comes in to use what they bought, front-desk staff on a phone cannot find "Verzilveren".
   - On a shared phone or tablet, they also cannot sign out.
4. **H1–H3, S2, R1 — The Dutch client app shows English and English-formatted money** (annoying, but on every screen every client sees from day one).
   - "NOT A MEMBER", "Members pay €76.50 →", "New", "Refer a friend / +100 Points";
   - "€76.50" next to "€ 126,50" on the same screen;
   - plus the understated package savings (S1).

   For a clinic paying for a white-label app in Dutch, this is the first impression.
5. **X1 — Deleting a client account does not cancel their membership** (blocks).
   - The first member who deletes their account keeps being charged and can no longer sign in to cancel.
   - That arrives at the clinic as an angry client or a charge dispute, and the portal keeps counting them as an active member.
