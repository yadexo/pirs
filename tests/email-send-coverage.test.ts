/**
 * Every transactional email's result is logged (lib/emails/send-log.ts).
 *
 * A send whose answer is thrown away is how production went silent: the
 * person was told "sent", the provider had refused or was never called, and
 * nothing anywhere said so. This finds each place that sends one email
 * through getEmailProvider() and checks the same file logs the result.
 * Campaigns are not here: lib/notifications-service.ts records every result
 * in NotificationDelivery instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const SENDERS = [...sourceFiles("lib"), ...sourceFiles("app")]
  .filter((file) => !file.replace(/\\/g, "/").startsWith("lib/providers/"))
  .map((file) => ({ file, source: readFileSync(file, "utf8") }))
  .filter(({ source }) => /getEmailProvider\(\)\s*\.send\(/.test(source));

describe("transactional email results", () => {
  it("finds the senders it is meant to guard", () => {
    const files = SENDERS.map(({ file }) => file.replace(/\\/g, "/")).sort();
    for (const expected of [
      "lib/actions/auth.ts",
      "lib/actions/clinic-settings.ts",
      "lib/actions/password.ts",
      "lib/client-notifications.ts",
      "lib/clinic-create.ts",
      "lib/platform-admin-create.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("logs the result wherever one is sent, once per send", () => {
    for (const { file, source } of SENDERS) {
      const sends = source.match(/getEmailProvider\(\)\s*\.send\(/g)!.length;
      const logs = source.match(/logEmailSend\(/g)?.length ?? 0;
      expect(logs, `${file} sends ${sends} email(s) but logs ${logs} result(s)`).toBeGreaterThanOrEqual(sends);
    }
  });
});
