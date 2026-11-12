# The registration code

Self-registration — the clinic register page and the admin register page — is
closed unless one environment variable is set:

```
REGISTRATION_CODE=<long random value — openssl rand -base64 24>
```

**Never a short number.** This code creates platform admins, who can open
every clinic. An earlier version of this page showed a six-digit example; if
any environment still uses that value, or any six-digit value, replace it —
it has been in the repository, and a million possibilities is not a secret.

**Leave it unset in production** except while you are actually letting
someone in. Unset, both pages 404 and invitations still work.

There are three limits on guessing: 10 attempts an hour per address, 5 per
email address, and 20 wrong codes an hour from everyone put together. The
last one pauses registration for everybody, including people with the right
code, until the hour is up — if a real person is refused with "too many
attempts" without having tried, someone is guessing, and the logs will show
`[register] outcome=rate_limited_everyone`.

Whoever has been told the code can create a clinic (with its owner) or a
platform admin. That is all it says. It is one shared secret: it does not
expire, it is not tied to a person, and it leaves no record of who was given
it. It exists so a handful of known people can be let in before there is a real
invitation system, and it is meant to be replaced.

## Turning registration off

Remove `REGISTRATION_CODE` from the environment (and redeploy — Vercel binds
environment variables per deployment, so saving the change is not enough).

With it unset:

- `/register/clinic` and `/register/admin` return 404;
- both register actions refuse even if a form is posted to them directly;
- the login pages stop showing a "register" link.

That is the fail-closed direction, and it is deliberate: forgetting to
configure the variable cannot leave a public sign-up open. It also means
**production has no open registration until the variable is set there**.

Existing accounts are unaffected. Invitations — a platform admin inviting
another admin from `/agency/settings`, a clinic owner inviting staff from App
Builder → Settings → Team — never use the code and keep working.

## Changing the code

Set the variable to the new value and redeploy. Anyone mid-registration simply
gets "that code isn't valid" and has to be told the new one. Nothing is stored
against the old code, so there is nothing to migrate.

## Replacing it with something better

The code is reached from exactly two places, both in `lib/actions/register.ts`:
`registerClinicAction` and `registerPlatformAdminAction`. Each one calls
`guardRegistration()` (same file) before it looks at anything else the form
said, and that is the only caller of `lib/registration-code.ts`.

To swap in a real invitation system:

1. Give invitations their own table (an email, a token hash, who issued it, an
   expiry, a used-at — `PasswordResetToken` is the shape to copy, and
   `lib/password-tokens.ts` already does the hashing).
2. Replace the body of `guardRegistration()` so it consumes an invitation
   instead of comparing a code. Keep the signature: both actions, their rate
   limits and their reason-coded logging stay as they are.
3. Delete `lib/registration-code.ts`, its test, and this file, and drop the
   variable from `.env.example` and from Vercel.

Nothing else reads the variable, so there is no other call site to find.

## Setting a password on the form instead (temporary)

```
REGISTRATION_SET_PASSWORD_DIRECTLY=1
```

With this set to exactly `1`, both register pages ask for a password (twice,
minimum 12 characters) and the account is **active the moment the form is
submitted**. No one-time link is issued and none is emailed; the welcome email
points at the sign-in page instead.

Anything else — including unset, which is the default — keeps the normal flow:
a one-time link, and an account that stays `INVITED` until it is used.

Everything else is unchanged. The registration code is still required, the
rate limits still apply, and two-factor setup is still forced for owners and
platform admins on their first page.

**What you give up by turning it on.** The link flow proves the person holds
the address before the account exists. Without it, anyone who knows the
registration code can create a working account against *someone else's* email
address — and that account is active immediately, not waiting on a mailbox
nobody is watching. Audit rows record which way each account was opened
(`passwordSetOnForm` in the metadata of `clinic.self_registered` and
`admin.self_registered`), so this is answerable after the fact.

It exists for setting a deployment up by hand when waiting on an inbox is in
the way. Turn it off again afterwards.

### Removing it

Unset the variable and redeploy — that alone restores the link flow
everywhere. To take the code out:

1. Delete `setPasswordDirectly()` from `lib/registration-code.ts` and
   `readChosenPassword()` from `lib/actions/register.ts`, along with the two
   `password:` fields they feed in `lib/clinic-create.ts` and
   `lib/platform-admin-create.ts` (each of those falls back to the `"!invited"`
   sentinel and the one-time link with nothing passed).
2. Delete `app/register/password-fields.tsx`, the `choosePassword` prop on both
   register forms and pages, and `lib/registration-constants.ts`.
3. Drop the `register.password.*`, `*.twoFactorNote` and `*.done.ready`
   message keys, and the variable from `.env.example` and from Vercel.

## What it is not

- **Not a substitute for the account checks.** A clinic owner still sets their
  own password from a one-time link, and two-factor setup is still forced for
  owners and platform admins. The code only gets the form to accept a
  submission.
- **Not a secret the server ever reveals.** It is never sent to the browser,
  never written to a log line (the reason codes are `code_missing` and
  `code_wrong`, never the value), and the error shown is the same for a wrong
  code as for a missing one.
- **Not rate-limiting on its own.** Guessing is limited per address and per
  email — see `guardRegistration()` — because a six-digit code is guessable
  otherwise. If you lengthen the code, leave the limits alone anyway.
