#!/usr/bin/env node
/**
 * Removes the .next build cache, cross-platform (`rm -rf` isn't available on
 * Windows shells). Used by `npm run dev:clean`.
 *
 * Needed because OneDrive's sync filter can leave `.next` in a state where
 * `next dev` fails with `EINVAL: invalid argument, readlink`.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".next");

if (!existsSync(target)) {
  console.log(".next does not exist — nothing to clear");
} else {
  rmSync(target, { recursive: true, force: true });
  console.log("Cleared .next");
}
