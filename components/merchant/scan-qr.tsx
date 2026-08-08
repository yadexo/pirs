"use client";

import * as React from "react";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/primitives";

/**
 * Check a client in or redeem a reward by scanning their app QR code.
 *
 * Camera capture is not wired up yet — the modal accepts a manually entered
 * code so the flow is usable and testable now. Swapping in a scanner later
 * only changes how `code` is produced.
 */
export function ScanQrButton() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <QrCode className="h-3.5 w-3.5" /> Scan QR
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Scan QR"
        subtitle="Check a client in, or redeem a reward."
        width="max-w-md"
      >
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="flex h-40 w-40 items-center justify-center rounded-card border border-dashed border-border bg-app text-ink-faint">
            <QrCode className="h-10 w-10" />
          </div>
          <p className="text-center text-[12px] text-ink-muted">
            Camera scanning is not enabled on this build. Enter the client&apos;s code manually to continue.
          </p>
          <input
            placeholder="Client code"
            className="h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <Button className="w-full" disabled>
            Look up client
          </Button>
        </div>
      </Drawer>
    </>
  );
}
