/**
 * Every state-changing clinic or platform-admin action leaves an audit row.
 *
 * docs/security/review-2026-11-pass2.md, I-4: a staff member could change
 * every membership in a clinic and leave no trace of who did it. The audit
 * row is how a clinic owner finds out what happened to their data; an action
 * that changes something without one is invisible.
 *
 * This reads the action files used by the clinic portal and the platform
 * admin, and fails for any exported action that writes to the database
 * without calling `audit(` or `writeAuditLog(`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ACTIONS_DIR = join(process.cwd(), "lib", "actions");

/**
 * Files a client, or someone not yet signed in, calls. Their actions are the
 * client's own doing and are recorded as activity, not in the clinic's audit
 * log.
 */
const CLIENT_FACING = new Set(["client-app.ts", "client-catalog.ts", "client-scan.ts", "clinic-directory.ts", "auth.ts", "password.ts", "session.ts", "guest-locale.ts"]);

/** "file:action" → why it writes without an audit row. */
const EXEMPT: Record<string, string> = {
  "account.ts:staffSaveLocaleAction": "A staff member's own language preference; changes nothing anyone else sees.",
  "two-factor.ts:startTwoFactorSetupAction": "Stores an unconfirmed secret for the signed-in user only; confirming it is audited.",
};

const WRITE = /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\badjust(?:Loyalty|Account)\w*\(|\$executeRaw/;
const AUDIT = /\baudit\(|\bwriteAuditLog\(|\bcommitChange\(/;

function actions(file: string) {
  const text = readFileSync(join(ACTIONS_DIR, file), "utf8").replace(/\r/g, "");
  const starts = [...text.matchAll(/^export async function (\w+)\(/gm)];
  return starts.map((m) => {
    // The body ends at the next top-level declaration, so a private helper
    // written after an action is not counted as part of it.
    const rest = text.slice(m.index! + m[0].length);
    const next = /\n(?:export |async function |function |const |let |type |interface )/.exec(rest);
    return { name: m[1]!, body: m[0] + (next ? rest.slice(0, next.index) : rest) };
  });
}

describe("state-changing clinic and admin actions write an audit row", () => {
  const files = readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts") && !CLIENT_FACING.has(f));

  it("reads the clinic and admin action files", () => {
    expect(files).toContain("client-membership.ts");
    expect(files).toContain("merchants.ts");
    expect(files.length).toBeGreaterThan(15);
  });

  it("every action that writes, audits", () => {
    const silent = files.flatMap((file) =>
      actions(file)
        .filter((a) => !(`${file}:${a.name}` in EXEMPT))
        .filter((a) => WRITE.test(a.body) && !AUDIT.test(a.body))
        .map((a) => `${file}: ${a.name}`),
    );
    expect(silent).toEqual([]);
  });

  it("has no stale exemptions", () => {
    for (const key of Object.keys(EXEMPT)) {
      const [file, name] = key.split(":");
      expect(actions(file!).some((a) => a.name === name), `${key} is exempt but does not exist`).toBe(true);
    }
  });
});
