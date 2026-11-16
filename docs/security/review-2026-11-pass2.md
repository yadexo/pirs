# Security review — November 2026, second pass

Reviewed on 16 November 2026 at commit `f2e1ef5` (`main`). Read-only: no
application code was changed, and this file is the only thing added. It
builds on [the first review](review-2026-11.md) and does not repeat it.

## 1. Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 2 |
| Medium | 6 |
| Low | 4 |

Plus two notes on first-review fixes (section 3), both Low.

**Do not onboard a real clinic before these are fixed** (details in section 4):

1. **I-3 — any client can move every appointment in their clinic.** Sending
   an object instead of an appointment id to the booking action makes it
   rewrite every appointment the clinic has. Reproduced: all 27 appointments
   moved to 03:00 on 3 March 2027 with one request.
2. **B-1 — rescheduling skips every booking rule.** A client can move their
   appointment onto a taken slot, outside opening hours, or onto another
   clinic's practitioner and location. Reproduced.
3. **I-4 — staff actions accept objects as ids too.** One request from a
   staff member with the right permission cancels every membership, or voids
   every unused item, in the clinic — with no billing history, no audit
   rows, an error shown to the staff member although every row changed, and
   Stripe left charging everyone except the first member. Reproduced for
   memberships and items.
4. **The money races (P-4, P-5, P-6, B-2).** Concurrent requests claim a
   once-only referral bonus 18 times, join a plan 10 times, use a one-time
   personal discount 5 times, and book one slot 8 times. Each reproduced.

**What the first round of fixes got right.** Every fix I attacked holds for
the case it was written for (section 3). The pattern that keeps coming back
is narrower than "validation is missing": the R-2 argument check stops at the
top level of each argument and covers only four client-side files, so object
values nested inside an argument, and every staff-side action, still reach
Prisma unchecked. Fix that once (section 6) and I-3 and I-4 close together.

## 2. Scope and method

**Targets used.** The repository at `f2e1ef5`, and a local production build
(`npm run serve`) against the local Docker database.

**Not used.** Production and staging were not contacted. No connection
string, key or token for either was requested or used. Stripe was not
configured locally, so every payment path ran on the mock provider; findings
that depend on Stripe behaviour are marked read only.

**How to read the labels.**

- **Verified by running** — reproduced against the local build. The request
  is given so you can repeat it.
- **Read only** — found in the code and not executed.

**How actions were called.** As in the first review: a session cookie from
`POST /api/client-auth/callback/credentials` (clients) or
`POST /api/auth/callback/credentials` with a TOTP code (staff), then
`POST <page>` with `Next-Action: <id>`, `Content-Type: text/plain` and a JSON
array of arguments. Ids come from `.next/server/server-reference-manifest.json`.
Races were fired with `Promise.all` over `fetch`, N identical requests at once.

**Local test data.** I created a second clinic (`sec2-other`) with a
practitioner, location, service, plan, client and item; a practitioner,
owner, two platform admins and three clients (`sec2-*@example.com`) in the
seeded Riverside clinic; and the appointments, orders, memberships, points,
credit, promotion and rate-limit rows the probes produced. All of it has been
deleted. Riverside's 25 seeded appointments were snapshotted before testing,
restored after each destructive probe, and match the snapshot. `git status`
shows only this file.

## 3. Part 1 — the first review's fixes, attacked

| Finding | Verdict | How it was attacked |
|---|---|---|
| P-1 negative quantity | **Holds** · verified | Negative, zero and huge quantities on both the add and set-quantity paths: refused; no order created. |
| T-1 shop shows other clinics' redemptions | **Holds** · verified | Redeemed an item in `sec2-other`, rendered Riverside's Shop page as its owner: absent. |
| A-1 two-factor on actions | **Holds** · verified | Admin without 2FA: clinic actions and `deleteMerchantAction` refused. Control admin with 2FA: allowed. See note 1. |
| A-2 / S-1 registration code | **Holds in code** · verified | Admin and clinic registration pages return 404 with the code unset. The production value is still yours to confirm. |
| P-2 mock payments in production | **Holds** · read only | `isRealProduction()` with no Stripe key now blocks; cannot be exercised locally without faking production. |
| D-1 / I-1 image proxy | **Holds** · verified | `/_next/image?url=https://www.wikipedia.org/...` is refused. Next.js at 15.5.29. |
| R-2 argument validation | **Incomplete** · verified | Top-level arguments are checked; values nested inside them are not, and staff-side files are not covered. This is I-3 and I-4. |
| N-1 broadcast via `sendMarketingTo` | **Holds** · read only | Single code path; replay not attempted. |
| N-2 marketing opt-in | **Holds** · verified | Turning notifications on without the offers box, and sending `"true"` as a string, both leave marketing off. |
| N-3 account deletion removes push | **Holds** · verified | Client closed their account: push subscriptions 0, user `DISABLED`. |
| A-3 sign-in timing | **Holds** · verified | Known vs unknown address within noise for accounts hashed at cost 12. See note 2. |
| A-4 sign-up enumeration | **Not re-tested** | The action takes `FormData`; I could not get a hand-built multipart body accepted (`Expected string, received null`). Relying on `tests/integration/enumeration.test.ts`. |
| A-5 lockout by strangers | **Holds** · verified | Twelve failures from one address on a client's account; the owner then signed in from their own address. Rotating addresses still hits the per-account cap. |
| T-2 / T-3 / T-4 | **Hold** · verified (T-3), read only (T-2, T-4) | Removed helpers are absent from the action manifest. |
| C-1 headers | **Holds for what was fixed** · verified | The headers the fix added are present on responses. |

**Note 1 — A-1.** The refusal from `deleteMerchantAction` arrives as an
unhandled server error (an `E{"digest":…}` response) rather than the
"two-factor first" message. It blocks, but the admin sees "something went
wrong". Low; cosmetic.

**Note 2 — A-3.** `prisma/seed.ts:11` hashes demo passwords at bcrypt cost
10; every production path uses cost 12 (`lib/password.ts`). A seeded account
answers about 4× faster than the dummy comparison, so timing distinguishes
seeded accounts. Only matters if a seeded account exists on production
(`testclinic2`'s users, if created by the seed). Re-hash them or delete them
before launch.

**Nothing the fixes newly broke** was found, beyond note 1.

## 4. Part 2 — areas the first review did not read fully

### 4.1 Booking and appointments

#### I-3 — An object as `appointmentId` rewrites every appointment in the clinic · Critical · Verified by running

**Where.** `lib/actions/client-app.ts:111` checks only that `input` is an
object (`z.record(z.unknown())`). `bookSchema` (`:90-95`) does not list
`appointmentId`. Then `:134-141`:

```ts
const existing = await db.appointment.findFirst({ where: { id: input.appointmentId, customerProfileId } });
...
await db.appointment.updateMany({ where: { id: input.appointmentId }, data: { startAt, endAt, staffProfileId, locationId, status: "CONFIRMED" } });
```

The `findFirst` is scoped to the client; the `updateMany` is not.

**Reproduce.** Signed in as any client of Riverside, `POST /app/riverside-wellness/book`
with `Next-Action` for `clientBookAction` and:

```json
["riverside-wellness", {"serviceId":"<any active service>","staffProfileId":"<any>","locationId":"<any>",
  "startAtIso":"2027-03-03T03:00:00.000Z","appointmentId":{"not":"x"}}]
```

`{"not":"x"}` matches the client's own appointment in `findFirst`, then
matches every appointment in the clinic in `updateMany`. Result: all 27
appointments (25 belonging to other clients) at the same time, the same
practitioner, `CONFIRMED`. `{"in":[…]}` targets chosen appointments instead.

**Impact.** Any client — anyone who signs up, since client accounts need no
verification (A-6) — can wipe out a clinic's diary in one request. Cancelled
appointments come back as confirmed; the real times are gone. The tenant
filter stops it at one clinic, which is the only thing that does.

**Fix.** Add `appointmentId: z.string().min(1).optional()` to `bookSchema` and
use the parsed value, not `input`, everywhere after the parse. Scope the
update to the row that was found: `where: { id: existing.id }`. Then the
general fix in section 6.

#### B-1 — Rescheduling skips availability and accepts another clinic's staff and location · High · Verified by running

**Where.** `lib/actions/client-app.ts:131`: `if (!free && !input.appointmentId)`.
When `appointmentId` is present the availability result is ignored. Nothing
checks that `staffProfileId` and `locationId` belong to this clinic, or that
the practitioner offers the service.

**Reproduce.** Same request shape as I-3 with the client's own appointment
id (a string):

1. `startAtIso` = another client's confirmed slot → `{"ok":true}`; two
   appointments now share it.
2. `staffProfileId` and `locationId` of the other clinic, `startAtIso`
   03:00 on a Sunday → `{"ok":true}`; the appointment now points at the
   other clinic's practitioner.

**Impact.** Clients can double-book any practitioner at any hour. An
appointment referencing another clinic's practitioner shows that person's
name in this clinic's portal and puts a stranger's appointment on their
calendar wherever staff calendars are read unscoped.

**Fix.** Run the same availability check for reschedules, excluding the
appointment being moved. Load the practitioner and location through the
scoped client and refuse if either is missing.

#### B-2 — Concurrent bookings take the same slot · Medium · Verified by running

**Where.** `lib/actions/client-app.ts:123-131` then `:226`. Check, then
create, with nothing between them.

**Reproduce.** Eight identical `clientBookAction` requests at once for one
free slot → eight `{"ok":true}`, eight `REQUESTED` appointments for one
practitioner at one time. A ninth, sent afterwards, is correctly refused
("That time was just taken").

**Impact.** Two clients opening the app at the same moment both get the
slot. Deliberate abuse needs only a script.

**Fix.** A database guarantee rather than a re-check: an exclusion
constraint on `(staffProfileId, tstzrange(startAt, endAt))` for active
statuses, or a transaction with `SELECT … FOR UPDATE` on the practitioner
row around the check and the insert.

#### R-3 — A malformed date raises an unhandled error · Low · Verified by running

**Where.** `lib/actions/client-app.ts:120`: `new Date(input.startAtIso)` with
`startAtIso: "not-a-date"` produces an invalid date that throws further down.

**Reproduce.** `startAtIso: "x"` → `1:E{"digest":"…"}`.

**Impact.** A stack trace in the logs per request; no data effect.

**Fix.** `startAtIso: z.string().datetime()` in `bookSchema`.

### 4.2 Memberships and membership billing

#### I-4 — Staff actions accept objects as ids: one request cancels every membership or voids every item · High · Verified by running (memberships, items) / Read only (catalogue)

**Where.**

- `lib/actions/client-membership.ts:131-134` (`openMembership` finds by
  `{ id: membershipId }`), then `updateMany({ where: { id: membershipId } })`
  at `:192` (cancel), `:236` (pause), `:268` (resume), `:321` (switch plan),
  `:374` (free periods).
- `lib/actions/client-items.ts:33` and `:63` (`voidClientItemAction`), and
  the reissue and gift actions after it.
- Same shape, read only: `lib/actions/app-builder.ts:434` (services), `:594`
  (packages), `:821` (promotions), `:1019` (plans), `:1125` (rewards).

None of these files is in the R-2 coverage test
(`tests/action-args-coverage.test.ts:20` lists four client-side files only).

**Reproduce.** As Riverside's owner (2FA confirmed), `POST /m/<clinicId>/clients`
with `Next-Action` for `cancelClientMembershipAction` and:

```json
["<clinicId>", {"not":"x"}, {"when":"now","reason":"x"}]
```

Every membership in the clinic becomes `CANCELLED`. The response is a
generic error, because the history write (`record()`) and the audit write
fail on the object id after the update has already happened — so the staff
member sees "failed" while every row has changed, and no billing-history
rows exist for any of them. `voidClientItemAction` with
`["<clinicId>", {"not":"x"}, {"reason":"x"}]` voids every unused item in the
clinic the same way.

**Impact.** A staff member with `memberships.manage` or `sales.manage` — or
anyone holding such an account — can end every client's membership or take
back every voucher in one request, with no trail. For a clinic on Stripe it
is worse: only the first membership found is cancelled at Stripe, so the
database says everyone is cancelled while Stripe keeps charging them. The
catalogue actions would overwrite every service, package, promotion, plan or
reward with the submitted values (not executed: see A-4 note on `FormData`).
Stays inside one clinic.

**Fix.** Validate every id argument with `arg.id` in these files and add
them to the coverage test. Update by the row that was found
(`where: { id: membership.id }`), never by the caller's value. Section 6.

#### P-5 — Joining a plan concurrently creates several memberships · Medium · Verified by running (mock) / Read only (Stripe)

**Where.** `lib/actions/client-app.ts:1165-1176` (look for an existing
membership) then `:1199` or the mock path (create). No lock or unique
constraint between them.

**Reproduce.** Ten `clientJoinPlanAction` requests at once for a plan with
€20 included credit, on the mock provider → ten `ACTIVE` memberships, €200
of credit.

**Impact.** On production the mock path is closed (P-2), so the live effect
is ten `PENDING` memberships, each with its own Stripe subscription and
idempotency key — a client who double-taps can be signed up and charged
more than once, and the clinic refunds by hand. The credit multiplication
needs the mock path.

**Fix.** A partial unique index on `CustomerMembership(customerProfileId)`
where status is in `MEMBERSHIP_HOLDS_SLOT`, and treat the unique violation
as "already a member".

### 4.3 Promotions, referral points, reviews

#### P-4 — The once-only referral bonus can be claimed many times at once · Medium · Verified by running

**Where.** `lib/actions/client-app.ts:1114-1124`: find an existing
"Referral shared" transaction, then award. `clientReviewAction`
(`:1093-1104`) is the same shape (read only).

**Reproduce.** Twenty `clientReferralAction` requests at once from one
client → 18 `{"ok":true,"points":100}`, 1,800 points, 18 transactions.

**Impact.** Points buy treatments and products. Twenty requests is a
one-line script; two hundred would do proportionally more.

**Fix.** A unique constraint (for example a nullable `uniqueKey` on
`LoyaltyTransaction` set to `referral:<profileId>` / `review:<profileId>`)
and treat the violation as "already claimed". Separately, the bonus is
granted for pressing "share", not for a referral that signs up — that is a
product decision, but it means the bonus is free points for everyone.

#### P-6 — A one-time personal discount can be used several times · Medium · Verified by running (concurrent) / Read only (sequential, Stripe)

**Where.** `lib/discounts.ts:264-265` counts `PromotionRedemption` rows to
enforce `perCustomerLimit` and `usageLimit`; those rows are written only
when an order is paid (`lib/order-completion.ts:61-63`).

**Reproduce.** Owner gives a client a 50% one-time discount; the client
checks out five times at once → five `PAID` orders at half price, five
redemptions recorded against a limit of 1.

**Impact.** Every limited promotion can be overrun by concurrent checkouts.
With Stripe, an order is paid when the webhook arrives, so a client can also
check out sequentially several times while the first payment is pending and
get the discount on each (read only).

**Fix.** Reserve the redemption when the order is created (a row with the
order id, conditional on the count being under the limit, in one statement
or under a lock) and delete it in `releaseFailedOrder`.

### 4.4 Orders, account credit and the cleanup cron

#### P-7 — Account credit applied to an order that then fails is lost · Medium · Verified by running

**Where.** `lib/actions/client-app.ts:659-668` takes the credit when a
pending order is created. `lib/order-completion.ts:98-125`
(`releaseFailedOrder`) gives back stock and points but not
`order.creditAppliedCents`. It is called when the client abandons the
payment (`client-app.ts:1017`), when Stripe reports a failed payment
(`lib/stripe-webhook.ts:369`), and by the hourly cleanup
(`lib/cron/jobs.ts:78`).

**Reproduce.** A `PENDING` order holding €10 of the client's credit (balance
debited to 0, as checkout does), then `clientAbandonOrderAction` with
`["riverside-wellness","<orderNumber>"]` → `{"ok":true}`, order `FAILED`,
credit still 0.

**Impact.** A client who pays part with credit and then closes the card
form, or whose card is declined, loses the credit. Not an attack — a
customer-service problem that will happen in the first week.

**Fix.** In `releaseFailedOrder`, after the claim, refund
`order.creditAppliedCents` with `adjustAccountCredit` (type `REFUND`,
`relatedOrderId`). Add a test beside the points one.

#### P-8 — The cleanup cron fails orders whose payment may still complete · Medium · Read only

**Where.** `lib/cron/jobs.ts:72-79` releases `PENDING` orders older than an
hour without cancelling the Stripe PaymentIntent.

**Impact.** A client who completes 3-D Secure after an hour, or a delayed
payment method, is charged for an order already marked `FAILED` with its
stock returned. What `completePaidOrder` does with a `FAILED` order when the
success webhook arrives decides whether the client gets their items; either
way the clinic has money without a matching sale.

**Fix.** Cancel the PaymentIntent before releasing (and only release if the
cancel succeeds or the intent is already cancelled); handle a late success
webhook on a `FAILED` order by refunding.

### 4.5 Packages, gifts and sessions

Package session use (`lib/package-redemption.ts:60-67`, compare-and-set on
the count that was read) and giving sessions (`lib/actions/client-app.ts:965-967`,
`remainingUses >= sessions`) are both conditional updates; I found no
double-spend path (read only).

#### A-12 — Giving sessions says whether a contact is a client · Low · Read only

**Where.** `lib/actions/client-app.ts:939-944` and the messages after it:
"not a client" and "sent" are different answers.

**Impact.** Any client with a transferable package can check whether a
given email or phone number belongs to another client of the same clinic.
Smaller than A-4 (it needs a package), same kind.

**Fix.** Answer the same way, and tell the giver only after the receiver
accepts — or accept that this is the feature and note it.

### 4.6 Birthday greetings, cron routes, clinic domains, App Builder forms, export and delete

- **Cron routes** — `/api/cron/*` without the secret → 401 (verified). Jobs
  are idempotent on re-run (read only). Apart from P-8, nothing found.
- **Birthday greetings** — sent from the marketing cron
  (`lib/cron/marketing.ts`) with a once-a-year guarantee keyed on the local
  year (read only). Nothing found.
- **Clinic-domain actions** — all three (`lib/actions/clinic-domains.ts:105,
  173, 237`) go through `requirePlatformAdminAction`, so two-factor and the
  impersonation guard apply (read only). H-1 from the first review still
  applies.
- **App Builder forms** — every `FormData` field in `lib/actions/app-builder.ts`
  is read by name with `formText` and passed through a zod schema; no form
  is spread into a write. **Allow-listed.** The id argument beside the form
  is not (I-4). `promotionSchema` caps `discountValue` later, not in the
  schema (read only, no effect found).
- **Data export and delete** — closing an account removes push
  subscriptions and disables the user (verified, N-3). I found no
  self-service data export for clients, so there was no export path to
  attack; exports, if a clinic is asked for one, are manual.

## 5. Part 3 — mass assignment, IDOR and anonymous access

**Mass assignment.** No request object is spread into a Prisma write any
more; the preferences fix holds. The live form of the same mistake is the
filter-object one in I-3 and I-4: the value is a string in TypeScript and an
object on the wire.

**IDOR, verified by running.**

| Request | Result |
|---|---|
| Client A, `GET /api/items/<other clinic's item>` | 404 — holds |
| Riverside owner, `clientAccountAction` with the other clinic's id | "You don't have access" — holds |
| Riverside owner, `clientAccountAction` with Riverside's id and the other clinic's client | "That client no longer exists" — holds |
| Riverside owner, `clientItemsAction` for the other clinic's client | empty list — holds |
| Riverside owner, `GET /m/<other clinic>` | 404 — holds |

**Anonymous access, verified by running.** Portal pages, agency pages and
server actions without a session → 307 to `/login`. `/api/cron/cleanup` →
401. `/api/internal/clinic-hosts` → 200 by design (S-2).

#### R-4 — API routes answer 500 instead of 401 without a session · Low · Verified by running

**Where.** `app/api/items/[itemId]/route.ts:14` and `app/api/push/route.ts:42`
call `requireCustomerContext()`, which throws `UnauthorizedError`; nothing
converts it.

**Reproduce.** `GET /api/items/x` and `GET /api/push` without a cookie → 500,
with an error and stack in the log.

**Impact.** No data leaks. Every unauthenticated hit is logged as a server
error, which hides real errors in Sentry and makes these routes easy to use
for noise.

**Fix.** Catch `UnauthorizedError` / `ForbiddenError` in route handlers and
return 401 / 403.

#### A-13 — Platform-admin actions skip the impersonation guard · Low · Read only

**Where.** `lib/actions/merchants.ts:26, 76, 111, 137`, `lib/actions/agency.ts:24`,
`lib/actions/impersonation.ts:16, 39`, `lib/actions/two-factor.ts:101, 118`
use `requireRole("PLATFORM_ADMIN")`. Two-factor is enforced there since A-1,
but `requirePlatformAdminAction` (`lib/platform-admin-action.ts`) also
refuses while impersonating, and these do not.

**Impact.** While impersonating a clinic, an admin can still create, suspend
or delete clinics and reset others' two-factor. Mostly a footgun.

**Fix.** Use `requirePlatformAdminAction()` in all of them.

## 6. What to fix, in order

| # | Finding | Effort |
|---|---|---|
| 1 | **The general fix for I-3 / I-4:** extend the R-2 coverage test to every file in `lib/actions/`, require `arg.id` for every id parameter, and parse nested objects with a strict zod schema whose result (not the raw input) is used. Update by the id of the row found, never by the caller's value. | 1 day |
| 2 | I-3 specifically: `appointmentId` in `bookSchema`, `where: { id: existing.id }` | 30 min |
| 3 | B-1: availability and tenant checks on reschedule | 2 h |
| 4 | P-7: return credit in `releaseFailedOrder` | 30 min |
| 5 | P-4, P-5, B-2: unique constraints / exclusion constraint (one migration) | half a day |
| 6 | P-6: reserve promotion redemptions at order creation | half a day |
| 7 | P-8: cancel the PaymentIntent before releasing | 2 h |
| 8 | R-3, R-4, A-13, note 1, A-12 | 2 h together |

## 7. What I did not check

- Production and staging, and the dashboards of Vercel, Neon, Stripe, R2,
  Resend and GoDaddy.
- Any path that needs a real Stripe account: subscriptions, Connect, the
  late-success webhook in P-8, the sequential case of P-6.
- A-4, and the catalogue half of I-4, because I could not get a hand-built
  `FormData` body accepted by the server action.
- N-1 and N-3 replays beyond what is listed.
- Real phones.

## 8. Go-live verdict

**Not yet.** The first review's six blockers are fixed and the fixes hold.
What blocks the first real clinic now:

1. **I-3** — one client request rewrites the clinic's whole diary. Critical,
   and trivially found by anyone who looks at the action payload.
2. **B-1** — clients can book any slot, any hour, any practitioner by
   rescheduling.
3. **I-4** — one staff request cancels every membership with no trail and
   leaves Stripe charging.
4. **P-7** — clients lose credit when a payment fails. It will happen in the
   first week without anyone attacking anything.

Fixes 1–4 in section 6 cover all four in about a day and a half. The races
(P-4, P-5, P-6, B-2) should follow before the clinic promotes the app to its
clients; they cost the clinic money but need deliberate effort to exploit.
Still outstanding from the first review and your list: unset the production
registration code (A-2, S-1), confirm the Stripe key in production (P-2), and
email verification for clients (A-6), which makes I-3 reachable by anyone
rather than by real clients only.
