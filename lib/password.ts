import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A hash of a random value nobody knows, made once per process with the same
 * cost as every real one. Nothing can match it.
 */
let unmatchable: Promise<string> | null = null;

/**
 * Does the work of checking a password without there being one to check.
 *
 * For the sign-in paths where no account was found: comparing against
 * nothing takes no time, comparing against a real hash takes a third of a
 * second, and that difference tells an attacker which addresses exist. This
 * makes the two cost the same. The result is thrown away — it is always
 * false.
 */
export async function spendPasswordCheck(plain: string): Promise<void> {
  unmatchable ??= bcrypt.hash(`unmatchable:${Math.random()}:${Date.now()}`, SALT_ROUNDS);
  await bcrypt.compare(plain, await unmatchable);
}
