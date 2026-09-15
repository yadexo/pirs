import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Home-screen icons for a clinic's installable app, made from the app icon the
 * clinic uploaded (App Builder → Branding), or a monogram tile when there is
 * none.
 */

export const ICON_SIZES = [180, 192, 512] as const;
export type IconVariant = { size: (typeof ICON_SIZES)[number]; maskable: boolean };

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/** Parses "192.png" or "maskable-512.png". Anything else is not an icon we make. */
export function parseIconFile(file: string): IconVariant | null {
  const m = /^(maskable-)?(\d+)\.png$/.exec(file);
  if (!m) return null;
  const size = Number(m[2]) as IconVariant["size"];
  if (!ICON_SIZES.includes(size)) return null;
  return { size, maskable: Boolean(m[1]) };
}

/**
 * Reads the uploaded image — only from our own storage. A stored URL pointing
 * anywhere else is ignored rather than fetched, so the icon route can never be
 * used to make the server request an arbitrary address.
 */
export async function loadIconSource(url: string | null | undefined, env: NodeJS.ProcessEnv = process.env): Promise<Buffer | null> {
  if (!url) return null;
  const local = /^\/uploads\/([A-Za-z0-9_-]+\.(?:png|jpe?g|gif|webp))$/.exec(url);
  if (local) {
    try {
      const buf = await readFile(path.join(process.cwd(), "public", "uploads", local[1]!));
      return buf.byteLength <= MAX_SOURCE_BYTES ? buf : null;
    } catch {
      return null;
    }
  }
  const publicBase = env.S3_PUBLIC_URL?.replace(/\/+$/, "");
  if (publicBase && url.startsWith(`${publicBase}/uploads/`) && !url.slice(publicBase.length).includes("..")) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.byteLength <= MAX_SOURCE_BYTES ? buf : null;
    } catch {
      return null;
    }
  }
  return null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function monogram(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join("");
  return letters || "•";
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A PNG icon. Maskable icons keep the artwork inside the 80% safe zone Android crops to. */
export async function renderAppIcon(
  source: Buffer | null,
  { size, maskable }: IconVariant,
  { name, color }: { name: string; color: string | null },
): Promise<Buffer> {
  const background = color && HEX.test(color) ? color : "#0b0d12";

  if (source) {
    try {
      if (!maskable) {
        // iOS rounds the corners itself and shows transparency as black.
        return await sharp(source).resize(size, size, { fit: "cover" }).flatten({ background: "#ffffff" }).png().toBuffer();
      }
      const inner = Math.round(size * 0.8);
      const art = await sharp(source).resize(inner, inner, { fit: "cover" }).png().toBuffer();
      return await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
        .composite([{ input: art, gravity: "center" }])
        .png()
        .toBuffer();
    } catch {
      // A corrupt upload falls through to the monogram rather than a broken icon.
    }
  }

  const text = escapeXml(monogram(name));
  const fontSize = Math.round(size * (maskable ? 0.32 : 0.4) * (text.length > 1 ? 0.85 : 1));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${background}"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
