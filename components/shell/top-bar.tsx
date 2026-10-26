import * as React from "react";
import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { RedeemButton } from "@/components/merchant/redeem";
import { ScanQrButton } from "@/components/merchant/scan-qr";

/**
 * The portal's top bar: Redeem, Scan QR, View app.
 *
 * These three are in the shell rather than on a page because they are what
 * somebody at the desk does from wherever they happen to be — a client walks
 * in while you are halfway through editing a price. The sidebar is a fixed six
 * items and these are not navigation, so they live here.
 */
export async function PortalTopBar({ merchantSlug }: { merchantSlug: string }) {
  const t = await getTranslations("portal");
  return (
    <header className="pk-topbar">
      <RedeemButton />
      <ScanQrButton />
      <a className="pk-topbtn" href={`/app/${merchantSlug}`} target="_blank" rel="noreferrer">
        <ExternalLink className="h-4 w-4" />
        {t("viewApp")}
      </a>
    </header>
  );
}
