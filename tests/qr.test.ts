import { describe, it, expect } from "vitest";
import sharp from "sharp";
import jsQR from "jsqr";
import { qrSvg } from "@/lib/qr";
import { mintCheckinToken } from "@/lib/checkin-token";

async function decode(svg: string): Promise<string | null> {
  const { data, info } = await sharp(Buffer.from(svg), { density: 300 }).resize(400, 400, { kernel: "nearest" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

describe("QR codes", () => {
  it("encode a check-in token that a scanner reads back exactly", async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    const token = mintCheckinToken("cmtenant0000000000000000", "cmprofile000000000000000");
    expect(await decode(qrSvg(token))).toBe(token);
  });

  it("encode a clinic join link", async () => {
    const url = "https://example.com/app/riverside-clinic?join=1";
    expect(await decode(qrSvg(url))).toBe(url);
  });
});
