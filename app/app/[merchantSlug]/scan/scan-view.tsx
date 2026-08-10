"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Gloss, QrCode, useToast } from "@/components/client-app/ui";
import { mintScanTokenAction } from "@/lib/actions/client-scan";
import { clientCheckInAction } from "@/lib/actions/client-app";

export function ScanView({
  merchantSlug,
  firstName,
  lastName,
  joinedDaysAgo,
  isMember,
}: {
  merchantSlug: string;
  firstName: string;
  lastName: string;
  joinedDaysAgo: number;
  isMember: boolean;
}) {
  const [token, setToken] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const { toast } = useToast();
  const router = useRouter();

  // The code carries a signed, short-lived token; refreshing it every 60s
  // means a screenshot stops working.
  React.useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      mintScanTokenAction()
        .then((t) => !cancelled && setToken(t))
        .catch(() => {
          /* keep the last code rather than blanking the card offline */
        });
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Hold the screen awake and bright while the code is on display.
  React.useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock
      ?.request("screen")
      .then((l) => {
        lock = l;
      })
      .catch(() => {});
    return () => {
      void lock?.release().catch(() => {});
    };
  }, []);

  async function checkIn() {
    setPending(true);
    const res = await clientCheckInAction(merchantSlug);
    setPending(false);
    if ("error" in res) {
      toast(res.error);
      return;
    }
    toast(res.points > 0 ? `Checked in · +${res.points} points` : "Checked in");
    router.refresh();
  }

  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "?";

  return (
    <div className="scanwrap">
      <div className="membercard">
        <Gloss className="qzone">
          <div className="qwhite">{token ? <QrCode value={token} /> : <span style={{ fontSize: 12, color: "var(--faint)" }}>Loading…</span>}</div>
        </Gloss>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
          <span className="avatar">{initials}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-strong)", display: "block", lineHeight: 1.2 }}>{firstName}</b>
            <span style={{ fontSize: 14, color: "var(--muted)" }}>Joined {joinedDaysAgo} days ago</span>
          </div>
          <span className="status-pill">{isMember ? "Member" : "Not a member"}</span>
        </div>
      </div>

      <p style={{ fontSize: 14, color: "var(--muted)", textAlign: "center", padding: "0 40px" }}>
        Show this at the clinic to check in and earn points.
      </p>

      {/* Until a merchant-side scanner exists, this is how a visit is recorded. */}
      <button
        onClick={checkIn}
        disabled={pending}
        style={{ fontSize: 13, color: "var(--faint)", textDecoration: "underline" }}
      >
        {pending ? "Checking in…" : "Simulate a clinic scan"}
      </button>
    </div>
  );
}
