import { getClientAppContext } from "@/lib/client-app-context";
import { getClientSummary } from "@/lib/client-app-data";
import { getHomeSections } from "@/lib/client-app-home";
import { getPromptHistory } from "@/lib/notification-prompt-data";
import { getNudgeHistory } from "@/lib/install-nudge-data";
import { NO_NUDGE_HISTORY } from "@/lib/install-nudge";
import { requestOrigin } from "@/lib/request-origin";
import { HomeView } from "./home-view";

export default async function ClientHomePage({ params }: { params: Promise<{ merchantSlug: string }> }) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);
  // The layout renders onboarding when logged out, but Next renders page and
  // layout in parallel — so this page must guard independently.
  if (!ctx.customerProfileId) return null;

  // The install nudge is remembered per address: a clinic with its own domain
  // has two, and a Home Screen icon added from one is a different app, with
  // its own storage, from one added from the other.
  const origin = await requestOrigin();
  const [summary, sections, promptHistory, settings, nudgeHistory] = await Promise.all([
    getClientSummary(ctx.db, ctx.customerProfileId),
    getHomeSections(ctx.db, { tenantId: ctx.merchant.id, customerProfileId: ctx.customerProfileId }),
    getPromptHistory(ctx.db, ctx.customerProfileId),
    ctx.db.tenantSettings.findFirst({ where: {}, select: { installNudgeEnabled: true } }),
    origin ? getNudgeHistory(ctx.db, ctx.customerProfileId, origin) : Promise.resolve(NO_NUDGE_HISTORY),
  ]);
  if (!summary) return null;

  return (
    <HomeView
      merchantSlug={merchantSlug}
      merchantName={ctx.merchant.name}
      logoUrl={ctx.merchant.logoUrl}
      currency={ctx.merchant.currency}
      summary={summary}
      sections={sections}
      promptHistory={promptHistory}
      nudgeEnabled={settings?.installNudgeEnabled ?? true}
      nudgeHistory={nudgeHistory}
    />
  );
}
