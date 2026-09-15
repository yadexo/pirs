import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { rawDb } from "@/lib/db";
import { getPublicClinic } from "@/lib/public-clinic";
import { LAST_CLINIC_COOKIE, isClinicSlug } from "@/lib/clinic-link";
import { ClinicFinder } from "./clinic-finder";
import "./[merchantSlug]/client-app.css";

export const metadata: Metadata = { title: "Find your clinic" };

/**
 * The general client app's front door. A returning client goes straight back
 * to their clinic; anyone else scans the clinic's QR code or searches by name.
 */
export default async function ClientAppEntry({ searchParams }: { searchParams: Promise<{ switch?: string }> }) {
  const { switch: switching } = await searchParams;
  const last = (await cookies()).get(LAST_CLINIC_COOKIE)?.value;
  if (switching !== "1" && isClinicSlug(last) && (await getPublicClinic(last))) {
    redirect(`/app/${last}`);
  }

  const agency = await rawDb.agencySettings.findFirst({ select: { name: true } });
  return (
    <div className="client-app">
      <ClinicFinder appName={agency?.name ?? "Your clinic app"} />
    </div>
  );
}
