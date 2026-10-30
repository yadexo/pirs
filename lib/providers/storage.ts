import "server-only";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { UploadError } from "@/lib/upload-error";
import { isRealProduction } from "@/lib/deploy-env";

export interface StoredFile {
  url: string;
  path: string;
}

export interface StorageProvider {
  upload(file: { buffer: Buffer; filename: string; mimeType: string }): Promise<StoredFile>;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Raster image types we accept, identified by their leading bytes.
 *
 * SVG is deliberately absent: it is XML that can carry <script>, and uploads
 * are served from our own origin, so an SVG "logo" would be stored XSS against
 * every clinic user and client who loads it.
 */
const SIGNATURES: { mime: string; ext: string; matches: (b: Buffer) => boolean }[] = [
  { mime: "image/png", ext: ".png", matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: ".jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", ext: ".gif", matches: (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii")) },
  {
    mime: "image/webp",
    ext: ".webp",
    matches: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/**
 * Checks size, then decides the type from the file's own bytes. The browser's
 * declared MIME type and the filename's extension are both attacker-chosen,
 * so neither is trusted: the stored extension and Content-Type come from what
 * the bytes actually are.
 */
export function validateUpload(file: { buffer: Buffer; mimeType?: string }): { mime: string; ext: string } {
  if (file.buffer.byteLength === 0) throw new Error("The file is empty");
  if (file.buffer.byteLength > MAX_FILE_BYTES) throw new Error("File exceeds the 5MB upload limit");
  const detected = SIGNATURES.find((s) => s.matches(file.buffer));
  if (!detected) throw new Error("Unsupported file type. Upload a PNG, JPEG, WebP or GIF image.");
  return { mime: detected.mime, ext: detected.ext };
}

class LocalStorageProvider implements StorageProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async upload(file: { buffer: Buffer; filename: string; mimeType: string }): Promise<StoredFile> {
    // Second line of defence behind getStorageProvider: writing to the
    // deployment's own filesystem is not storage on a serverless host, it is
    // an EROFS a moment later (or, worse, a file that vanishes on the next
    // deploy and takes every clinic's logo with it).
    assertLocalDiskIsWritable(this.env);
    const { ext } = validateUpload(file);
    const safeName = `${nanoid(16)}${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const fullPath = path.join(dir, safeName);
    await writeFile(fullPath, file.buffer);
    return { url: `/uploads/${safeName}`, path: fullPath };
  }
}

/**
 * S3-compatible storage: AWS S3, Cloudflare R2, MinIO, and similar.
 *
 *   STORAGE_PROVIDER=s3
 *   S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   S3_REGION        "auto" for R2, e.g. "eu-central-1" for AWS
 *   S3_ENDPOINT      omit for AWS; R2: https://<account>.r2.cloudflarestorage.com
 *   S3_PUBLIC_URL    public base URL objects are served from (bucket domain / CDN)
 */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"].filter((k) => !env[k]?.trim());
    if (missing.length) {
      throw new UploadError("storageMisconfigured", `S3 storage is selected but not configured. Missing: ${missing.join(", ")}.`);
    }
    // "auto" is R2's region and is not a region AWS knows. Against real S3 it
    // fails as "the authorization header is malformed", which reads like a
    // credentials problem and sends people looking in the wrong place.
    if (!env.S3_ENDPOINT?.trim() && (env.S3_REGION ?? "").trim().toLowerCase() === "auto") {
      console.warn('[storage] S3_REGION is "auto" with no S3_ENDPOINT. That pairing is for Cloudflare R2; AWS S3 needs a real region such as eu-central-1.');
    }
    this.bucket = env.S3_BUCKET!;
    this.publicUrl = env.S3_PUBLIC_URL!.replace(/\/+$/, "");
    this.client = new S3Client({
      region: env.S3_REGION || "auto",
      endpoint: env.S3_ENDPOINT || undefined,
      // R2 and MinIO address buckets by path; AWS accepts it too.
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    });
  }

  async upload(file: { buffer: Buffer; filename: string; mimeType: string }): Promise<StoredFile> {
    const { mime, ext } = validateUpload(file);
    const key = `uploads/${nanoid(16)}${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: mime,
        // Names are random and never reused, so a long cache is safe.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return { url: `${this.publicUrl}/${key}`, path: key };
  }
}

/**
 * Whether this host can be written to at all. Vercel's filesystem is read-only
 * apart from /tmp, which does not survive the request — so "local" storage
 * there is not a fallback, it is a silent data-loss bug.
 */
function localDiskIsWritable(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.VERCEL && !isRealProduction(env);
}

function assertLocalDiskIsWritable(env: NodeJS.ProcessEnv = process.env): void {
  if (localDiskIsWritable(env)) return;
  throw new UploadError(
    "storageMisconfigured",
    'Uploads are set to local disk, which this host cannot write to. Set STORAGE_PROVIDER="s3" (with S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_PUBLIC_URL) for this deployment.',
  );
}

/**
 * Which storage this deployment uses — and a loud failure when that question
 * has no good answer.
 *
 * This used to be `=== "s3" ? S3 : Local`, so every other value — unset, a
 * capital "S3", a space pasted into a dashboard field, a variable scoped to
 * the wrong environment — quietly became "write to the local disk", which on
 * Vercel is a read-only filesystem. Every clinic's upload failed with an
 * EROFS reported as if the clinic had sent a bad file. Misconfiguration now
 * says so, in the log and to the person uploading.
 *
 * Only whitespace is forgiven. A value that is nearly right is reported
 * rather than guessed at, because guessing is what hid this for months.
 */
export function getStorageProvider(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  const configured = (env.STORAGE_PROVIDER ?? "").trim();

  if (configured === "s3") return new S3StorageProvider(env);

  if (configured !== "" && configured !== "local") {
    throw new UploadError(
      "storageMisconfigured",
      `STORAGE_PROVIDER is "${configured}", which is not a storage provider. Use "s3" (lowercase) for S3-compatible storage, or "local" for development.`,
    );
  }

  assertLocalDiskIsWritable(env);
  return new LocalStorageProvider(env);
}
