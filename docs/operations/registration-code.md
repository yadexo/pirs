# The registration code

Self-registration — the clinic register page and the admin register page — is
closed unless one environment variable is set:

```
REGISTRATION_CODE=081946
```

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
