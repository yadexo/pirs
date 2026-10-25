# Working on this repo

White-label, multi-tenant clinic SaaS (branded "Pirs"). Three surfaces, one
codebase: agency admin (`/agency`), clinic portal (`/m/:merchantId`), client
app (`/app/:merchantSlug`). See `README.md` for the architecture.

**Never use the name "Dermis"**; **do not position for medspas**; **do not
claim regulatory compliance**; **never store card information**; tenant
isolation is enforced at the data layer (`lib/tenant-db.ts`) — don't bypass it
with the raw client except in platform-admin code paths.

## Local environment

- The repo lives at `C:\dev\deza`. If a tool reports a different cwd (an
  OneDrive path), that's a stale pre-move copy — switch back to `C:\dev\deza`.
- No GNU `make` on this Windows box — use the `.ps1` scripts directly or via
  their `npm run` wrappers, never a `Makefile` target.
- Leave the production build running via `npm run serve` for manual checks —
  **never `next dev`** for anything that needs to look real (dev mode and prod
  mode render differently enough to matter here). Don't add `loading.tsx`.
- Run the full suite with Docker (and `next build`) before every commit:
  `npm run lint && npm test && npm run build`.
- Commit with `git -c user.name=dev -c user.email=dev@example.com` and end
  commit messages with the `Co-Authored-By` line the session gives you.

## Deployment

There are three environments:

| | Database | Where it runs | Branch |
|---|---|---|---|
| Local dev | Docker Postgres (`app_dev` / `app_test`) | your machine | any |
| **Staging** | Neon branch `staging` | Vercel Preview, fixed URL (see `docs/deployment/staging-setup.md`) | `staging` |
| **Production** | Neon `production` branch (`ep-frosty-cloud-zal3mzce`) | Vercel Production, `pirs.io` / `clinic.pirs.io` | `main` |

**Until the first real clinics are onboarded: work directly on `main`, test
on production with `testclinic2`.** This is a temporary, explicitly-chosen
exception to the normal rule below — there are no real clinics on production
yet, so there's nothing at risk in testing there with the dedicated test
clinic. Push straight to `main`:

```bash
git checkout main
git pull
# ...work, commit...
git push                      # deploys to pirs.io / clinic.pirs.io
```

Keep `staging` in sync so it's ready the moment this exception ends — merge
`main` into `staging` (and push) after each change lands on `main`:

```bash
git checkout staging
git pull
git merge main
git push
git checkout main
```

**Once real clinics are onboarded, switch back to staging-first, for good.**
Branch off `staging` (or push directly to it for small changes), let it
deploy, test it at the staging URL — including on a real phone — and only
then merge `staging` into `main` to ship to production:

```bash
git checkout staging
git pull
# ...work, commit...
git push                      # deploys to the staging URL automatically
# once it looks right on staging:
git checkout main
git pull
git merge staging
git push                      # deploys to pirs.io / clinic.pirs.io
```

**Never touch the production database or production Vercel env vars without
asking first.** Production database tasks go through `npm run prod:*`
(`scripts/prod.ps1`), which prompts for the connection string and never
writes it to disk. The equivalent staging tasks are `npm run stg:*`
(`scripts/staging.ps1`), which additionally refuses outright if it's ever
handed the production connection string — `stg:wipe` deletes every row in
every table, so that guard isn't optional. This rule doesn't change under the
direct-to-main exception above — testing with `testclinic2` on production
never means running destructive or untested database commands against it.

First-time staging/Vercel/Neon/Stripe setup: `docs/deployment/staging-setup.md`.
