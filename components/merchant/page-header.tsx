import * as React from "react";
import { ScanQrButton } from "./scan-qr";

/**
 * The top bar shared by every sub-account page: page title on the left,
 * merchant identity + Scan QR on the right.
 */
export function MerchantPageHeader({
  title,
  merchantName,
  children,
}: {
  title: React.ReactNode;
  merchantName: string;
  /** Page-specific controls that sit left of the merchant identity. */
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[26px] font-semibold leading-8">{title}</h1>
      <div className="flex items-center gap-2">
        {children}
        <span className="hidden text-[13px] text-ink-muted sm:inline">{merchantName}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
          {merchantName.charAt(0).toUpperCase()}
        </span>
        <ScanQrButton />
      </div>
    </header>
  );
}
