import { NextRequest, NextResponse } from "next/server";
import { requireStaffContext } from "@/lib/rbac";
import { getStorageProvider } from "@/lib/providers/storage";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { user } = await requireStaffContext();

  const { ok } = await rateLimit(`upload:${user.id}`, 30, 60 * 1000);
  if (!ok) return NextResponse.json({ error: "Too many uploads. Slow down." }, { status: 429 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const stored = await getStorageProvider().upload({
      buffer,
      filename: file.name,
      mimeType: file.type,
    });
    return NextResponse.json({ url: stored.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
