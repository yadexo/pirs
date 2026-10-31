/**
 * Tests an S3-compatible storage config end to end: writes a tiny real
 * object, reads it back through the public URL the app would use, then
 * deletes it. Every value is asked for at the prompt and is gone when the
 * process exits — nothing is written to disk, and nothing on this machine's
 * own environment is read or changed.
 *
 *   npm run prod:storage-check
 *
 * Use this when uploads fail with "storage isn't set up correctly" and the
 * server log (search Vercel's logs for "[uploads]") doesn't say enough on
 * its own. In particular: a WRONG BUT PRESENT S3_PUBLIC_URL never throws in
 * the app — uploads keep succeeding, and only the read-back (and every icon
 * and launch image the app renders from storage) quietly fails. The upload
 * route's own error can't see that; this check uploads and reads back for
 * real, so it can.
 */
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ask, AdminSetupError, exitWith } from "./admin-cli";

export interface S3CheckConfig {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  region: string;
  endpoint: string | undefined;
}

async function promptForConfig(): Promise<S3CheckConfig> {
  console.log("Nothing typed here is saved. These values live only in this process and are gone the moment it exits.\n");

  const bucket = (await ask("S3_BUCKET: ")).trim();
  if (!bucket) throw new AdminSetupError("S3_BUCKET is required. Nothing was tested.");

  const accessKeyId = (await ask("S3_ACCESS_KEY_ID: ")).trim();
  if (!accessKeyId) throw new AdminSetupError("S3_ACCESS_KEY_ID is required. Nothing was tested.");

  const secretAccessKey = (await ask("S3_SECRET_ACCESS_KEY (input hidden): ", { hidden: true })).trim();
  if (!secretAccessKey) throw new AdminSetupError("S3_SECRET_ACCESS_KEY is required. Nothing was tested.");

  const publicUrl = (await ask("S3_PUBLIC_URL: ")).trim().replace(/\/+$/, "");
  if (!publicUrl) throw new AdminSetupError("S3_PUBLIC_URL is required. Nothing was tested.");

  const region = (await ask('S3_REGION (blank = "auto", R2\'s value — wrong for real AWS): ')).trim() || "auto";
  const endpoint = (await ask("S3_ENDPOINT (blank for real AWS S3; R2's account URL otherwise): ")).trim() || undefined;

  return { bucket, accessKeyId, secretAccessKey, publicUrl, region, endpoint };
}

export interface CheckResult {
  ok: boolean;
  step: "upload" | "read-back" | "ok";
  message: string;
}

/**
 * The thing the app itself does on every upload: write to the bucket, then
 * trust S3_PUBLIC_URL to read it back — which is exactly the step the app
 * never verifies, because it has no reason to GET what it just PUT.
 */
export async function checkStorage(config: S3CheckConfig, fetchImpl: typeof fetch = fetch): Promise<CheckResult> {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  const key = `uploads/storage-check-${randomBytes(8).toString("hex")}.txt`;
  const body = `storage check ${new Date().toISOString()}`;

  try {
    await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: "text/plain", CacheControl: "no-store" }));
  } catch (err) {
    return { ok: false, step: "upload", message: describeAwsError(err) };
  }

  try {
    const url = `${config.publicUrl}/${key}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      return {
        ok: false,
        step: "read-back",
        message: `The upload succeeded, but ${url} could not be reached at all: ${err instanceof Error ? err.message : String(err)}. S3_PUBLIC_URL is likely pointed at the wrong host.`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        step: "read-back",
        message: `The upload succeeded, but GET ${url} returned ${res.status} ${res.statusText}. Credentials and S3_BUCKET are fine — this is S3_PUBLIC_URL (wrong prefix for this bucket) or the bucket/CDN not serving objects publicly.`,
      };
    }
    const text = await res.text();
    if (text !== body) {
      return {
        ok: false,
        step: "read-back",
        message: `GET ${url} returned content that doesn't match what was just written. S3_PUBLIC_URL may resolve to a different bucket, or a CDN in front of it is serving a stale or unrelated object from the same path.`,
      };
    }
  } finally {
    // Best-effort: leaving one stray test object behind is not worth a
    // second failure mode in this script.
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })).catch(() => {});
  }

  return { ok: true, step: "ok", message: "Uploaded, read back byte-for-byte through S3_PUBLIC_URL, and cleaned up. This configuration works." };
}

export function describeAwsError(err: unknown): string {
  const e = err as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const code = e.Code ?? e.name ?? "UnknownError";
  const status = e.$metadata?.httpStatusCode;
  const hint =
    code === "SignatureDoesNotMatch"
      ? " — check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, and S3_REGION if this is real AWS (not R2's \"auto\")."
      : code === "NoSuchBucket"
        ? " — S3_BUCKET does not exist at this endpoint/region."
        : code === "AccessDenied"
          ? " — the key is valid but lacks s3:PutObject (and s3:DeleteObject) on this bucket."
          : code === "PermanentRedirect"
            ? " — wrong S3_REGION or S3_ENDPOINT for this bucket."
            : code === "CredentialsProviderError" || code === "InvalidAccessKeyId"
              ? " — S3_ACCESS_KEY_ID is not recognised."
              : "";
  return `${code}${status ? ` (HTTP ${status})` : ""}: ${e.message ?? String(err)}${hint}`;
}

async function main() {
  console.log("Testing S3-compatible storage end to end — nothing is saved.\n");
  const config = await promptForConfig().catch(exitWith);

  console.log(`\nBucket:     ${config.bucket}`);
  console.log(`Endpoint:   ${config.endpoint ?? "s3.amazonaws.com (real AWS)"}  (region: ${config.region})`);
  console.log(`Public URL: ${config.publicUrl}\n`);

  const result = await checkStorage(config);
  if (result.ok) {
    console.log(`✓ ${result.message}`);
    console.log("\nIf uploads still fail in production, the values Vercel actually has differ from what was just tested here — check them there, not here.");
  } else {
    console.error(`✗ Failed at ${result.step}: ${result.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(exitWith);
}
