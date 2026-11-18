/**
 * Checks the email settings once at startup (instrumentation.ts), so a
 * deployment that cannot send email says so in its first log lines — not
 * weeks later, when someone asks for a password reset and nothing arrives.
 *
 * Email goes out through Resend only when EMAIL_PROVIDER is exactly "resend"
 * (lib/providers/notifications/index.ts); anything else is the mock, which in
 * real production refuses every email (lib/providers/notifications/mock.ts).
 *
 * Real production (the same signal as lib/deploy-env.ts) gets an error;
 * Vercel's Preview, which is staging, gets a warning; a developer's machine
 * gets nothing, because the mock is what it is meant to use there. Only
 * names and shapes are reported — never a value, so never the key. No
 * imports, so it is safe anywhere it might be called.
 */
export function emailConfigWarning(env: Record<string, string | undefined> = process.env): { level: "error" | "warn"; message: string } | null {
  const production = env.VERCEL_ENV === "production" || env.APP_ENV === "production";
  const preview = env.VERCEL_ENV === "preview";
  if (!production && !preview) return null;

  const problems: string[] = [];
  const provider = env.EMAIL_PROVIDER;
  if (provider === undefined || provider === "") {
    problems.push('EMAIL_PROVIDER is not set, so no email is sent (set it to "resend")');
  } else if (provider !== "resend") {
    if (/^["'\s]|["'\s]$/.test(provider) && provider.replace(/["'\s]/g, "") === "resend") {
      problems.push('EMAIL_PROVIDER has spaces or quotes around "resend"; it must be exactly resend');
    } else if (provider.toLowerCase() === "resend") {
      problems.push(`EMAIL_PROVIDER is "${provider}"; it must be "resend", lowercase`);
    } else {
      // A short label like "mock" is shown; anything long is not echoed back.
      const shown = /^[A-Za-z0-9_-]{1,20}$/.test(provider) ? `"${provider}"` : "set to something else";
      problems.push(`EMAIL_PROVIDER is ${shown}, so no email is sent (set it to "resend")`);
    }
  }

  if (!env.RESEND_API_KEY?.trim()) problems.push("RESEND_API_KEY is not set");

  const from = env.EMAIL_FROM?.trim();
  if (!from) {
    problems.push("EMAIL_FROM is not set");
  } else if (/^["'].*["']$/.test(from)) {
    problems.push("EMAIL_FROM is wrapped in quotes; enter the bare address, e.g. no-reply@mail.deza.ai");
  } else {
    const address = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(address)) problems.push("EMAIL_FROM has no email address in it");
  }

  if (problems.length === 0) return null;
  return {
    level: production ? "error" : "warn",
    message: `[email] This deployment cannot send email: ${problems.join("; ")}. Fix it in the environment variables and redeploy.`,
  };
}
