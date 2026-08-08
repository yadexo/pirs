import { headers } from "next/headers";
import { rawDb } from "@/lib/db";
import { requireAgencyContext } from "@/lib/merchant-context";
import { AgencyShell } from "@/components/shell/app-shell";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const { support } = await requireAgencyContext();
  const agency = await rawDb.agencySettings.findFirst();
  const pathname = (await headers()).get("x-pathname") ?? "/agency";

  return (
    <AgencyShell agencyName={agency?.name ?? "DezaAI"} support={support} pathname={pathname}>
      {children}
    </AgencyShell>
  );
}
