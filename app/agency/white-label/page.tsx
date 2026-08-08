import { rawDb } from "@/lib/db";
import { requireAgencyContext } from "@/lib/merchant-context";
import { WhiteLabelForm } from "./white-label-form";

export default async function WhiteLabelPage() {
  await requireAgencyContext();
  const agency = await rawDb.agencySettings.findFirst();

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="text-[26px] font-semibold leading-8">White Label</h1>
      <p className="mt-1 text-[13px] text-ink-muted">
        How the platform appears to your merchants. Each merchant brands their own client app separately.
      </p>
      <div className="mt-6">
        <WhiteLabelForm
          settings={
            agency
              ? {
                  name: agency.name,
                  logoLightUrl: agency.logoLightUrl,
                  logoDarkUrl: agency.logoDarkUrl,
                  faviconUrl: agency.faviconUrl,
                  primaryColor: agency.primaryColor,
                  customDomain: agency.customDomain,
                  supportLabel: agency.supportLabel,
                  supportUrl: agency.supportUrl,
                  senderName: agency.senderName,
                  loginBgUrl: agency.loginBgUrl,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
