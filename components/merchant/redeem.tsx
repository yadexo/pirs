"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, CheckCircle2, Keyboard, Loader2, Search, Ticket } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Drawer, Pill } from "@/components/ui/primitives";
import { useQrCamera, type CameraProblem } from "@/components/use-qr-camera";
import { describeActionFailure } from "@/lib/action-failure";
import { lookupRedeemableAction, redeemItemAction } from "@/lib/actions/redeem";
import type { ItemView } from "@/lib/redeemable";
import { ClientPackages } from "@/components/merchant/client-packages";
import { searchClientsForCheckInAction } from "@/lib/actions/check-in";

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
  | { kind: "finding" }
  | { kind: "loading" }
  | { kind: "found"; item: ItemView; method: "QR" | "BACKUP_CODE" }
  | { kind: "client"; customerProfileId: string; name: string }
  | { kind: "done"; item: ItemView };

export function RedeemButton() {
  const params = useParams<{ merchantId?: string }>();
  const merchantId = params?.merchantId;
  const t = useTranslations("merchant.redeem");
  const [open, setOpen] = React.useState(false);

  if (!merchantId) return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Ticket className="h-3.5 w-3.5" /> {t("redeem")}
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={t("redeemAnItem")} subtitle={t("scanSubtitle")}>
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
  const t = useTranslations("merchant.redeem");
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
        <p className="text-[13px] text-ink-muted">{t("redeemedFor", { name: stage.item.client.name })}</p>
        <div className="mt-2 flex w-full gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            {t("done")}
          </Button>
          <Button className="flex-1" onClick={() => setStage({ kind: "scanning" })}>
            {t("nextItem")}
          </Button>
        </div>
      </div>
    );
  }

  if (stage.kind === "client") {
    return (
      <div className="space-y-4">
        <div className="rounded-card bg-app p-4">
          <p className="text-[15px] font-semibold">{stage.name}</p>
          {/* Sessions are a count, not a ticket, so there is nothing to scan. */}
          <p className="mt-0.5 text-[13px] text-ink-muted">{t("sessionPackagesToday")}</p>
        </div>
        <ClientPackages merchantId={merchantId} customerProfileId={stage.customerProfileId} />
        <Button variant="outline" className="w-full" onClick={() => setStage({ kind: "finding" })}>
          {t("findSomeoneElse")}
        </Button>
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
      <div className="flex rounded-[12px] bg-app p-1 text-[14px]" role="tablist">
        {(["scanning", "typing", "finding"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={stage.kind === k}
            onClick={() => setStage({ kind: k })}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-2 ${stage.kind === k ? "bg-surface font-bold text-ink" : "text-ink-muted"}`}
          >
            {k === "scanning" ? <Camera className="h-4 w-4" /> : k === "typing" ? <Keyboard className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            {k === "scanning" ? t("scanCode") : k === "typing" ? t("typeCode") : t("findClient")}
          </button>
        ))}
      </div>
      {stage.kind === "scanning" ? (
        <CodeScanner onCode={onCode} onUnavailable={toTyping} />
      ) : stage.kind === "typing" ? (
        <CodeEntry onSubmit={(v) => void lookup(v, "BACKUP_CODE")} />
      ) : (
        <ClientFinder merchantId={merchantId} onPick={(customerProfileId, name) => setStage({ kind: "client", customerProfileId, name })} />
      )}
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
  const t = useTranslations("merchant.redeem");
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
            <dt className="text-ink-muted">{t("purchased")}</dt>
            <dd className="font-medium">{purchased}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">{t("code")}</dt>
            <dd className="tabular font-medium">{item.code}</dd>
          </div>
        </dl>
        {item.refundedAfterUse && <p className="mt-3 rounded-[10px] bg-[var(--accent-amber)]/10 px-3 py-2 text-[12px]">{t("refundedAfterUseNotice")}</p>}
      </div>

      {item.status === "AVAILABLE" ? (
        <>
          {onNoteChange && (
            <label className="block text-[12px] text-ink-muted">
              {t("noteOptional")}
              <input
                value={note ?? ""}
                onChange={(e) => onNoteChange(e.target.value)}
                placeholder={t("notePlaceholder")}
                maxLength={200}
                className="mt-1 h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
          )}
          <Button className="w-full" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("redeemThisItem")}
          </Button>
        </>
      ) : (
        <p className="rounded-[10px] bg-app px-3 py-2 text-center text-[13px] text-ink-muted">
          {item.status === "REDEEMED"
            ? redeemed && item.redeemedByName
              ? t("alreadyRedeemedOnBy", { date: redeemed, name: item.redeemedByName })
              : redeemed
                ? t("alreadyRedeemedOn", { date: redeemed })
                : item.redeemedByName
                  ? t("alreadyRedeemedBy", { name: item.redeemedByName })
                  : t("alreadyRedeemed")
            : item.status === "VOIDED"
              ? t("voidedNotice")
              : t("expiredNotice")}
        </p>
      )}

      {onBack && (
        <Button variant="ghost" className="w-full" onClick={onBack}>
          {t("back")}
        </Button>
      )}
    </div>
  );
}

function CodeScanner({ onCode, onUnavailable }: { onCode: (value: string) => void; onUnavailable: () => void }) {
  const t = useTranslations("merchant.redeem");
  const CAMERA_PROBLEMS: Record<CameraProblem, string> = {
    unsupported: t("cameraProblems.unsupported"),
    denied: t("cameraProblems.denied"),
    missing: t("cameraProblems.missing"),
  };
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const { problem: problemKind, starting } = useQrCamera(videoRef, onCode);
  const problem = problemKind ? CAMERA_PROBLEMS[problemKind] : null;

  if (problem) {
    return (
      <div className="space-y-3 py-4 text-center">
        <p className="text-[13px] text-ink-muted">{problem}</p>
        <Button variant="outline" onClick={onUnavailable}>
          <Keyboard className="h-3.5 w-3.5" /> {t("typeTheCode")}
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
      <p className="text-center text-[12px] text-ink-muted">{t("askClientToOpen")}</p>
    </div>
  );
}

function CodeEntry({ onSubmit }: { onSubmit: (value: string) => void }) {
  const t = useTranslations("merchant.redeem");
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
        {t("codeUnderQr")}
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ABCD2345"
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label={t("itemCode")}
          className="tabular mt-1 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-[16px] uppercase tracking-[0.15em] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>
      <Button type="submit" className="w-full" disabled={clean.length < 8}>
        {t("findItem")}
      </Button>
    </form>
  );
}

/**
 * Finding a client when there is no code: a package is a count on their
 * record rather than a ticket in their hand, so the way to it is through
 * them.
 */
function ClientFinder({ merchantId, onPick }: { merchantId: string; onPick: (customerProfileId: string, name: string) => void }) {
  const t = useTranslations("merchant.redeem");
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<{ customerProfileId: string; name: string; email: string | null }[]>([]);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    // Typed, not submitted: a short wait keeps one query per pause rather
    // than one per keystroke.
    const id = setTimeout(async () => {
      setSearching(true);
      const res = await searchClientsForCheckInAction(merchantId, term).catch(() => ({ error: "" }));
      setSearching(false);
      setResults("error" in res ? [] : res.results);
    }, 250);
    return () => clearTimeout(id);
  }, [query, merchantId]);

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("nameEmailPhone")}
        autoFocus
        className="h-12 w-full rounded-[14px] bg-surface px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--ink)]"
      />
      {searching && <Loader2 className="mx-auto h-4 w-4 animate-spin text-ink-muted" />}
      {results.length > 0 && (
        <ul className="divide-y divide-border rounded-card bg-app">
          {results.map((r) => (
            <li key={r.customerProfileId}>
              <button
                type="button"
                onClick={() => onPick(r.customerProfileId, r.name)}
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-surface"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink">{r.name}</span>
                  {r.email && <span className="block truncate text-[13px] text-ink-muted">{r.email}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="py-4 text-center text-[13px] text-ink-muted">{t("nobodyFound")}</p>
      )}
    </div>
  );
}
