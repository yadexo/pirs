/**
 * Command-line helpers shared by the one-off admin scripts in this folder
 * (create-platform-admin.ts, reset-platform-admin-password.ts).
 */
import { createInterface } from "node:readline";

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** A problem the operator should read; the script exits without changing anything. */
export class AdminSetupError extends Error {}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

export const flag = (name: string) => process.argv.includes(`--${name}`);

export function ask(question: string, { hidden = false } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden && process.stdin.isTTY) {
      // Print the question, then swallow what readline would echo.
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.includes(question)) write.call(rl, s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** Asks twice without echoing. `--password` is accepted but ends up in shell history. */
export async function readNewPassword(label = "Password"): Promise<string> {
  const given = arg("password");
  if (given) {
    console.warn("Note: --password is now in your shell history. Prefer the prompt next time.");
    return given;
  }
  if (!process.stdin.isTTY) {
    console.warn("Warning: this terminal isn't interactive, so the password may be shown as you type. PowerShell or Windows Terminal hides it.");
  }
  const password = await ask(`${label} (min ${MIN_ADMIN_PASSWORD_LENGTH} characters): `, { hidden: true });
  const again = await ask(`Repeat ${label.toLowerCase()}: `, { hidden: true });
  if (again !== password) throw new AdminSetupError("The passwords don't match. Nothing was changed.");
  return password;
}

export function checkPassword(password: string): void {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) throw new AdminSetupError(`Use a password of at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`);
  if (password.length > 200) throw new AdminSetupError("Keep the password under 200 characters.");
}

/** "ep-xxx.neon.tech / neondb" — enough to recognise the target, never the password. */
export function describeDatabase(url: string | undefined): string {
  if (!url) return "(DATABASE_URL is not set)";
  try {
    const u = new URL(url);
    return `${u.hostname} / ${u.pathname.replace(/^\//, "") || "(default)"}`;
  } catch {
    return "(DATABASE_URL could not be read)";
  }
}

/** Shows what is about to change and where; `--yes` skips the prompt. */
export async function confirmOrCancel(summary: string): Promise<void> {
  console.log(`\n${summary}`);
  console.log(`in database: ${describeDatabase(process.env.DATABASE_URL)}`);
  if (flag("yes")) return;
  const answer = await ask('Type "yes" to continue: ');
  if (answer.trim().toLowerCase() !== "yes") throw new AdminSetupError("Cancelled. Nothing was changed.");
}

/** Prints an operator-readable message and exits non-zero. */
export function exitWith(err: unknown): never {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
