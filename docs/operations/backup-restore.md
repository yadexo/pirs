# Restoring the production database — step by step

Neon keeps a continuous history of every production database (point-in-time
restore, "PITR") for a retention window set by your Neon plan (7 days on
Free/Launch, 30 on Scale, configurable higher on Business/Enterprise —
check **Project Settings → Storage** for the exact window on your plan).
Restoring does not mean editing the live database in place; it means
creating a **new branch** of it as of a chosen moment, checking that branch
is actually what you want, and only then pointing production at it. Nothing
below modifies the live `production` branch directly, and nothing here was
run against production — see §4 for how this was tested instead.

## When to do this

- A migration or a bad `prod:*` script run damaged real data.
- You need to recover specific rows (a client's order, a clinic's catalogue)
  that were deleted and the in-app history doesn't cover it.
- You need to compare "now" against "an hour ago" to find out what changed.

**Not for this:** a single accidentally-deleted record a clinic admin can fix
themselves — check the Audit Log tab first (App Builder → Settings → Audit
log), since most day-to-day changes are already reversible from there without
touching the database at all.

## 1. Find the moment to restore to

Neon console → your project → **Branches** → the `production` branch →
**Restore** (or **Branches → Create Branch**, Parent: `production`, with a
specific timestamp/LSN instead of "now" — both paths get you to the same
picker). Neon shows a timeline; pick either:

- A **timestamp** ("5 minutes before the bad migration ran") — easiest when
  you know roughly when things went wrong.
- An **LSN** (a specific transaction) — use this if you know the exact
  commit, e.g. from Neon's own query history showing the last-good state.

Pick the **moment just before** the damage, not an exact guess — a branch a
few minutes too early costs you a few minutes of otherwise-good data to
reconcile by hand; a branch even one write too late brings the damage with
it.

## 2. Create the restore as a branch, not a restore-in-place

Whether you used **Restore** or **Create Branch**, the result is a new
branch — e.g. `restore-2026-10-24-0830` — that is a full, independent copy of
production as it stood at that moment. **Production itself is untouched** at
this point; this branch is just sitting there for you to inspect.

## 3. Verify the branch before using it

Do not point production at the new branch yet. Instead, from the repo:

```bash
npm run prod:status -- --url "<the restore branch's connection string>"
```

(Or omit `--url` and paste it at the prompt — see `scripts/prod.ps1`'s own
doc comment; despite the name, it works against any Postgres connection
string, it just labels the prompt "Production".) This confirms the schema on
the branch matches what the app expects (no pending migrations). Then spot-
check the actual data — the specific records you're recovering — with a
read-only query:

```bash
# paste the restore branch's connection string when asked
npm run prod:client -- --clinic <slug> --email <client-email>
```

or any other read-only `prod:*` task, or `psql` directly, to confirm the
rows you need are there and look right.

## 4. Promote the branch (what actually changes production)

Once verified, there are two ways to make this branch "production", from
least to most disruptive:

**A. Point the app at the new branch** (fastest, no data copy):
In Vercel, update the **Production**-scoped `DATABASE_URL` environment
variable to the restore branch's connection string, then redeploy. Neon lets
you keep the old `production` branch around (rename it
`production-pre-restore-2026-10-24` first, so nothing is lost) and simply
stop using it. This is the recommended approach — it's a config change, not
a data-moving operation, so it's fast and trivially reversible by pointing
the env var back.

**B. Reset the `production` branch itself to the restore point** (Neon's own
"Restore" button does this in place, replacing the branch's current head)
— only do this if you specifically need the branch named `production` to be
the one serving the app (e.g. other tooling hardcodes that branch name).
This is harder to undo — Neon keeps the pre-restore state reachable by LSN
for your retention window, but you're now relying on that window rather than
an explicitly renamed branch.

Either way, after promoting:
```bash
npm run prod:migrate   # confirm nothing is pending; a restore to an old
                        # enough point may be behind recent migrations
```

## 5. Tell the clinics

If the restore window covers real client activity (orders, bookings,
payments) that happened between the restore point and now, that activity is
gone from the database even though Stripe/the client's bank still processed
it. Cross-reference Stripe's own dashboard (Payments, in the affected date
range) against what's now in the database, and manually re-enter anything
that's missing — this is the one step that can't be scripted, since it
depends on judgement about what actually needs restating to a client.

## Tested, without touching production

This procedure was verified against the `staging` Neon branch rather than
production, by:

1. Creating a disposable branch off `staging` (parent: `staging`, a specific
   timestamp a few minutes in the past).
2. Running `npm run stg:status` (the staging equivalent of the `prod:status`
   step above — see `docs/deployment/staging-setup.md`) against it to
   confirm the schema check works the same way.
3. Spot-checking a known seeded record was present and unchanged.
4. Deleting the disposable branch afterwards (Neon branches cost nothing to
   create or discard — this is exactly why step 2 above creates a branch to
   inspect rather than restoring in place sight-unseen).

This confirms the *mechanics* (branch from a point in time, verify with
`prod:status`/`stg:status`, read-only spot-check) work end to end. It does
not substitute for having actually done this once against production before
you need it for real — consider doing exactly the dry run above against
production the first calm day you have, verifying only, never promoting the
branch, so the real thing isn't the first time.
