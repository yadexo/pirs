import { getPublicClinic } from "@/lib/public-clinic";

/**
 * The clinic's logo (or name) above the password pages, when the page is for
 * one clinic's clients — on its own domain, or opened from its app.
 *
 * On a clinic's own domain the client should see only that clinic: a reset
 * page with no sign of who it belongs to, on an address they may not
 * recognise yet, is exactly what a phishing page looks like.
 */
export async function ClinicMark({ slug }: { slug: string | null }) {
  const clinic = slug ? await getPublicClinic(slug) : null;
  if (!clinic) return null;
  return (
    <div className="mb-4 flex flex-col items-center gap-2 text-center">
      {clinic.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- an uploaded logo of unknown size, shown as is
        <img src={clinic.logoUrl} alt={clinic.name} className="max-h-12 max-w-[180px] object-contain" />
      ) : (
        <p className="text-[16px] font-semibold" style={clinic.color ? { color: clinic.color } : undefined}>
          {clinic.name}
        </p>
      )}
    </div>
  );
}
