import { describe, it, expect, beforeAll } from "vitest";
import { S3Client, CreateBucketCommand, GetObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { S3StorageProvider } from "@/lib/providers/storage";
import { checkStorage, type S3CheckConfig } from "../../prisma/storage-check";

/**
 * Round-trips a real upload through an S3-compatible server. Runs when
 * S3_TEST_ENDPOINT is set — locally: `docker compose --profile s3 up -d s3`
 * then S3_TEST_ENDPOINT=http://localhost:4566.
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
const env = {
  S3_BUCKET: "deza-test-uploads",
  S3_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY_ID ?? "test",
  S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "test",
  S3_REGION: "us-east-1",
  S3_ENDPOINT: endpoint,
  S3_PUBLIC_URL: `${endpoint}/deza-test-uploads`,
} as unknown as NodeJS.ProcessEnv;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest-of-image")]);

describe.skipIf(!endpoint)("S3 storage provider", () => {
  const raw = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });

  beforeAll(async () => {
    try {
      await raw.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    } catch {
      await raw.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
    }
  });

  it("stores the bytes with the detected content type under a random key", async () => {
    const stored = await new S3StorageProvider(env).upload({ buffer: PNG, filename: "logo.html", mimeType: "text/html" });

    expect(stored.path).toMatch(/^uploads\/[A-Za-z0-9_-]{16}\.png$/);
    expect(stored.url).toBe(`${env.S3_PUBLIC_URL}/${stored.path}`);

    const obj = await raw.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: stored.path }));
    expect(obj.ContentType).toBe("image/png");
    expect(obj.CacheControl).toContain("immutable");
    expect(Buffer.from(await obj.Body!.transformToByteArray()).equals(PNG)).toBe(true);
  });

  it("refuses to start with missing configuration, naming what is missing", () => {
    expect(() => new S3StorageProvider({ S3_BUCKET: "x" } as unknown as NodeJS.ProcessEnv)).toThrow(
      /Missing: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL/,
    );
  });

  /**
   * prisma/storage-check.ts — the tool for "uploads fail with 'storage isn't
   * set up correctly'". The case it exists for is the one the app itself
   * can never catch: S3_PUBLIC_URL present but wrong, which lets every
   * upload keep succeeding while every icon and launch image quietly fails.
   */
  describe("storage-check", () => {
    const config: S3CheckConfig = {
      bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      publicUrl: env.S3_PUBLIC_URL!,
      region: "us-east-1",
      endpoint,
    };

    it("uploads and reads back byte-for-byte", async () => {
      const result = await checkStorage(config);
      expect(result).toMatchObject({ ok: true, step: "ok" });
    });

    it("names the bucket problem when the bucket doesn't exist", async () => {
      const result = await checkStorage({ ...config, bucket: "this-bucket-does-not-exist-anywhere" });
      expect(result.ok).toBe(false);
      expect(result.step).toBe("upload");
      expect(result.message).toMatch(/NoSuchBucket/);
    });

    it("catches a wrong-but-present S3_PUBLIC_URL, which the app itself never detects", async () => {
      // The upload still succeeds — this is exactly why the app's own error
      // handling can't see this class of misconfiguration.
      const result = await checkStorage({ ...config, publicUrl: `${config.publicUrl}-wrong` });
      expect(result.ok).toBe(false);
      expect(result.step).toBe("read-back");
      expect(result.message).toMatch(/could not be reached|S3_PUBLIC_URL/);
    });

    it("catches S3_PUBLIC_URL pointing at a different, still-reachable bucket", async () => {
      // A stub fetch stands in for "reachable, but serving someone else's
      // object" — the one failure mode that needs a byte mismatch, not a
      // network error, to prove it's being checked at all.
      const stub: typeof fetch = async () => new Response("not what was uploaded", { status: 200 });
      const result = await checkStorage(config, stub);
      expect(result.ok).toBe(false);
      expect(result.step).toBe("read-back");
      expect(result.message).toMatch(/doesn't match|different bucket/);
    });
  });
});
