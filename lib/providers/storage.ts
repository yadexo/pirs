import "server-only";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

export interface StoredFile {
  url: string;
  path: string;
}

export interface StorageProvider {
  upload(file: { buffer: Buffer; filename: string; mimeType: string }): Promise<StoredFile>;
}

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

export function validateUpload(file: { buffer: Buffer; mimeType: string }) {
  if (!ALLOWED_MIME_TYPES.has(file.mimeType)) {
    throw new Error(`Unsupported file type: ${file.mimeType}`);
  }
  if (file.buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error("File exceeds the 5MB upload limit");
  }
}

class LocalStorageProvider implements StorageProvider {
  async upload(file: { buffer: Buffer; filename: string; mimeType: string }): Promise<StoredFile> {
    validateUpload(file);
    const ext = path.extname(file.filename).toLowerCase() || guessExt(file.mimeType);
    const safeName = `${nanoid(12)}${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const fullPath = path.join(dir, safeName);
    await writeFile(fullPath, file.buffer);
    return { url: `/uploads/${safeName}`, path: fullPath };
  }
}

/**
 * Placeholder for S3-compatible storage. Documented integration point:
 * set STORAGE_PROVIDER=s3 and S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/
 * S3_SECRET_ACCESS_KEY/S3_ENDPOINT, then implement upload() with the AWS SDK
 * (@aws-sdk/client-s3) or any S3-compatible client. Not implemented here
 * because no credentials are available in this environment.
 */
class S3StorageProvider implements StorageProvider {
  async upload(): Promise<StoredFile> {
    throw new Error(
      "S3 storage is not configured. Implement lib/providers/storage.ts#S3StorageProvider with your S3 SDK of choice, or set STORAGE_PROVIDER=local.",
    );
  }
}

function guessExt(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    default:
      return "";
  }
}

export function getStorageProvider(): StorageProvider {
  return process.env.STORAGE_PROVIDER === "s3" ? new S3StorageProvider() : new LocalStorageProvider();
}
