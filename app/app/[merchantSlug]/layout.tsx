import { getClientAppContext } from "@/lib/client-app-context";
import { Onboarding } from "./onboarding";
import { ClientAppShell } from "./shell";
import { CartProvider } from "./cart-context";
import "./client-app.css";

export default async function ClientAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  const ctx = await getClientAppContext(merchantSlug);

  const style = ctx.merchant.accentColor ? ({ "--merchant-accent": ctx.merchant.accentColor } as React.CSSProperties) : undefined;

  if (!ctx.customerProfileId) {
    return (
      <div className="client-app" style={style}>
        <Onboarding merchantSlug={merchantSlug} merchantName={ctx.merchant.name} logoUrl={ctx.merchant.logoUrl} />
      </div>
    );
  }

  return (
    <div className="client-app" style={style}>
      <CartProvider merchantSlug={merchantSlug}>
        <ClientAppShell merchantSlug={merchantSlug} logoUrl={ctx.merchant.logoUrl}>
          {children}
        </ClientAppShell>
      </CartProvider>
    </div>
  );
}
