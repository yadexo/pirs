import { headers } from "next/headers";
import { requireMerchantContext } from "@/lib/merchant-context";
import { MerchantShell } from "@/components/shell/app-shell";

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

  return (
    <MerchantShell
      merchantId={ctx.merchantId}
      merchantName={ctx.merchantName}
      support={ctx.support}
      pathname={pathname}
      impersonating={ctx.impersonating}
      switchableMerchants={ctx.switchableMerchants}
    >
      {children}
    </MerchantShell>
  );
}
