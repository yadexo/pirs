import { headers } from "next/headers";
import { requireMerchantContext } from "@/lib/merchant-context";
import { MerchantShell } from "@/components/shell/app-shell";
import { ClinicTimeZoneProvider } from "@/components/clinic-time-zone";
import { clinicZone } from "@/lib/clinic-zone";

export default async function MerchantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  const ctx = await requireMerchantContext(merchantId);
  const pathname = (await headers()).get("x-pathname") ?? `/m/${merchantId}`;
  // Every date and time in the portal is the clinic's, not the laptop's.
  const timeZone = await clinicZone(ctx.db);

  return (
    <MerchantShell
      merchantId={ctx.merchantId}
      merchantName={ctx.merchantName}
      merchantSlug={ctx.merchantSlug}
      accentColor={ctx.accentColor}
      support={ctx.support}
      pathname={pathname}
      impersonating={ctx.impersonating}
      switchableMerchants={ctx.switchableMerchants}
      viewerName={ctx.viewer.name}
      viewerRole={ctx.viewer.role}
    >
      <ClinicTimeZoneProvider timeZone={timeZone}>{children}</ClinicTimeZoneProvider>
    </MerchantShell>
  );
}
