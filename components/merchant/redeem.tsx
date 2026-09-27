"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, CheckCircle2, Keyboard, Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, Pill } from "@/components/ui/primitives";
import { useQrCamera, type CameraProblem } from "@/components/use-qr-camera";
import { describeActionFailure } from "@/lib/action-failure";
import { lookupRedeemableAction, redeemItemAction } from "@/lib/actions/redeem";
import type { ItemView } from "@/lib/redeemable";

/**
 * Handing a client the thing they bought: scan the code in their app, or type
 * the eight characters printed under it.
 *
 * Scanning never redeems on its own. Staff see the item, the client's name and
 * the status first, then confirm — a code caught by accident while pointing
 * the camera around costs nothing.
 */

type Stage =
  | { kind: "scanning" }
  | { kind: "typing" }
  | { kind: "loading" }
  | { kind: "found"; item: ItemView; method: "QR" | "BACKUP_CODE" }
  | { kind: "done"; item: ItemView };

export function RedeemButton() {
  const params = useParams<{ merchantId?: string }>();
  const merchantId = params?.merchantId;
  const [open, setOpen] = React.useState(false);

  if (!merchantId) return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Ticket className="h-3.5 w-3.5" /> Redeem
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Redeem an item" subtitle="Scan the code in the client's app." width="max-w-md">
        {open && <RedeemFlow merchantId={merchantId} onClose={() => setOpen(false)} />}
      </Drawer>
    </>
  );
}

const STATUS_TONE = {
  AVAILABLE: "green",
  REDEEMED: "amber",
  VOIDED: "red",
  EXPIRED: "neutral",
} as const;

function RedeemFlow({ merchantId, onClose }: { merchantId: string; onClose: () => void }) {
  const router = useRouter();
  const [stage, setStage] = React.useState<Stage>({ kind: "scanning" });
  const [pending, setPending] = React.useState(false);

  const lookup = React.useCallback(
    async (value: string, method: "QR" | "BACKUP_CODE") => {
      setStage({ kind: "loading" });
      const res = await lookupRedeemableAction(merchantId, value).catch((err) => ({ error: describeActionFailure(err) }));
      if ("error" in res) {
        toast.error(res.error);
        setStage(method === "QR" ? { kind: "scanning" } : { kind: "typing" });
        return;
      }
      setStage({ kind: "found", item: res.item, method });
    },
    [merchantId],
  );

  // Stable identity: the camera restarts if this changes.
  const onCode = React.useCallback((value: string) => void lookup(value, "QR"), [lookup]);
  const toTyping = React.useCallback(() => setStage({ kind: "typing" }), []);

  async function confirm() {
    if (stage.kind !== "found") return;
    setPending(true);
    const res = await redeemItemAction(merchantId, { itemId: stage.item.id, method: stage.method }).catch((err) => ({
      error: describeActionFailure(err),
    }));
    setPending(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setStage({ kind: "done", item: res.item });
    router.refresh();
  }

  if (stage.kind === "loading") {
    return (
      <div className="flex h-60 items-center justify-center text-ink-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (stage.kind === "done") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-[var(--accent-green)]" />
        <p className="text-[16px] font-semibold">{stage.item.name}</p>
        <p className="text-[13px] text-ink-muted">Redeemed for {stage.item.client.name}.</p>
        <div className="mt-2 flex w-full gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Done
          </Button>
          <Button className="flex-1" onClick={() => setStage({ kind: "scanning" })}>
            Next item
          </Button>
        </div>
      </div>
    );
  }

  if (stage.kind === "found") {
    return (
      <ItemCard
        item={stage.item}
        pending={pending}
        onConfirm={confirm}
        onBack={() => setStage({ kind: stage.method === "QR" ? "scanning" : "typing" })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex rounded-[10px] border border-border p-0.5 text-[12px]" role="tablist">
        {(["scanning", "typing"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={stage.kind === k}
            onClick={() => setStage({ kind: k })}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-1.5 ${stage.kind === k ? "bg-primary-soft font-medium text-primary" : "text-ink-muted"}`}
          >
            {k === "scanning" ? <Camera className="h-3.5 w-3.5" /> : <Keyboard className="h-3.5 w-3.5" />}
            {k === "scanning" ? "Scan code" : "Type code"}
          </button>
        ))}
      </div>
      {stage.kind === "scanning" ? <CodeScanner onCode={onCode} onUnavailable={toTyping} /> : <CodeEntry onSubmit={(v) => void lookup(v, "BACKUP_CODE")} />}
    </div>
  );
}

/** The item, its client and its state — everything staff need before confirming. */
export function ItemCard({
  item,
  pending,
  onConfirm,
  onBack,
  note,
  onNoteChange,
}: {
  item: ItemView;
  pending: boolean;
  onConfirm: () => void;
  onBack?: () => void;
  /** Manual redemptions can carry a reason; scanned ones don't need one. */
  note?: string;
  onNoteChange?: (value: string) => void;
}) {
  const purchased = new Date(item.purchasedAt).toLocaleDateString();
  const redeemed = item.redeemedAt ? new Date(item.redeemedAt).toLocaleString() : null;

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold">{item.name}</p>
            <p className="truncate text-[12px] text-ink-muted">
              {item.client.name}
              {item.client.email ? ` · ${item.client.email}` : ""}
            </p>
          </div>
          <Pill tone={STATUS_TONE[item.status]}>{item.status.toLowerCase()}</Pill>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <dt className="text-ink-muted">Purchased</dt>
            <dd className="font-medium">{purchased}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Code</dt>
            <dd className="tabular font-medium">{item.code}</dd>
          </div>
        </dl>
        {item.refundedAfterUse && (
          <p className="mt-3 rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px]">
            This order was refunded after the item had already been redeemed.
          </p>
        )}
      </div>

      {item.status === "AVAILABLE" ? (
        <>
          {onNoteChange && (
            <label className="block text-[12px] text-ink-muted">
              Note (optional)
              <input
                value={note ?? ""}
                onChange={(e) => onNoteChange(e.target.value)}
                placeholder="Client's phone was dead"
                maxLength={200}
                className="mt-1 h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
          )}
          <Button className="w-full" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Redeem this item
          </Button>
        </>
      ) : (
        <p className="rounded-[10px] bg-app px-3 py-2 text-center text-[13px] text-ink-muted">
          {item.status === "REDEEMED"
            ? `Already redeemed${redeemed ? ` on ${redeemed}` : ""}${item.redeemedByName ? ` by ${item.redeemedByName}` : ""}.`
            : item.status === "VOIDED"
              ? "This item was refunded, so it can't be redeemed."
              : "This item has expired."}
        </p>
      )}

      {onBack && (
        <Button variant="ghost" className="w-full" onClick={onBack}>
          Back
        </Button>
      )}
    </div>
  );
}

const CAMERA_PROBLEMS: Record<CameraProblem, string> = {
  unsupported: "This browser can't use a camera here. Type the code instead.",
  denied: "Camera access was blocked. Allow it in the browser's site settings, or type the code.",
  missing: "No camera found. Type the code instead.",
};

function CodeScanner({ onCode, onUnavailable }: { onCode: (value: string) => void; onUnavailable: () => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const { problem: problemKind, starting } = useQrCamera(videoRef, onCode);
  const problem = problemKind ? CAMERA_PROBLEMS[problemKind] : null;

  if (problem) {
    return (
      <div className="space-y-3 py-4 text-center">
        <p className="text-[13px] text-ink-muted">{problem}</p>
        <Button variant="outline" onClick={onUnavailable}>
          <Keyboard className="h-3.5 w-3.5" /> Type the code
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-card bg-[var(--text-primary)]">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-[18%] rounded-[18px] border-2 border-white/80" aria-hidden="true" />
        {starting && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
      </div>
      <p className="text-center text-[12px] text-ink-muted">Ask the client to open the item in My items and hold up their phone.</p>
    </div>
  );
}

function CodeEntry({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = React.useState("");
  const clean = value.trim().toUpperCase();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length >= 8) onSubmit(clean);
      }}
    >
      <label className="block text-[12px] text-ink-muted">
        Code under the QR
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ABCD2345"
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="Item code"
          className="tabular mt-1 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-[16px] uppercase tracking-[0.15em] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>
      <Button type="submit" className="w-full" disabled={clean.length < 8}>
        Find item
      </Button>
    </form>
  );
}
