import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CRON_JOBS } from "@/lib/cron/jobs";

export const dynamic = "force-dynamic";

/**
 * Runs a scheduled job. Callers authenticate with `Authorization: Bearer
 * <CRON_SECRET>` — the header Vercel Cron sends, and easy to add from any
 * other scheduler. With no CRON_SECRET configured the endpoint refuses every
 * call rather than running unauthenticated.
 */
async function handle(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron is not configured (CRON_SECRET unset)." }, { status: 503 });
  }

  const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { job } = await params;
  const run = Object.hasOwn(CRON_JOBS, job) ? CRON_JOBS[job] : undefined;
  if (!run) return NextResponse.json({ error: `Unknown job "${job}".` }, { status: 404 });

  const startedAt = Date.now();
  try {
    const result = await run();
    return NextResponse.json({ job, ok: true, ms: Date.now() - startedAt, result });
  } catch (err) {
    console.error(`[cron] ${job} failed`, err);
    return NextResponse.json({ job, ok: false, error: "Job failed; see server logs." }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
