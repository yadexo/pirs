"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, CheckCircle2, Loader2, QrCode, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, Pill } from "@/components/ui/primitives";
import {
  checkInClientAction,
  lookupClientForCheckInAction,
  searchClientsForCheckInAction,
  type CheckInTarget,
  type ClientCard,
} from "@/lib/actions/check-in";

type Stage =
  | { kind: "scanning" }
  | { kind: "searching" }
  | { kind: "loading" }
  | { kind: "client"; client: ClientCard; target: CheckInTarget }
  | { kind: "done"; client: ClientCard; points: number };

/**
 * Check a client in by scanning the code on their app's Scan tab, or by
 * finding them by name when there is no code to scan. Only this records a
 * visit — clients cannot check themselves in.
 */
export function ScanQrButton() {
  const params = useParams<{ merchantId?: string }>();
  const merchantId = params?.merchantId;
  const [open, setOpen] = React.useState(false);

  // The header also renders on pages outside a clinic; there is nothing to scan into there.
  if (!merchantId) return null;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <QrCode className="h-3.5 w-3.5" /> Scan QR
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Check in a client" subtitle="Scan the code in their app." width="max-w-md">
        {open && <CheckInFlow merchantId={merchantId} onClose={() => setOpen(false)} />}
      </Drawer>
    </>
  );
}

function CheckInFlow({ merchantId, onClose }: { merchantId: string; onClose: () => void }) {
  const router = useRouter();
  const [stage, setStage] = React.useState<Stage>({ kind: "scanning" });
  const [pending, setPending] = React.useState(false);

  const lookup = React.useCallback(
    async (target: CheckInTarget) => {
      setStage({ kind: "loading" });
      const res = await lookupClientForCheckInAction(merchantId, target);
      if ("error" in res) {
        toast.error(res.error);
        setStage("token" in target ? { kind: "scanning" } : { kind: "searching" });
        return;
      }
      setStage({ kind: "client", client: res.client, target });
    },
    [merchantId],
  );

  // Stable identities: CameraScanner restarts the camera if these change.
  const onCode = React.useCallback((token: string) => void lookup({ token }), [lookup]);
  const toSearch = React.useCallback(() => setStage({ kind: "searching" }), []);

  async function confirm() {
    if (stage.kind !== "client") return;
    setPending(true);
    const res = await checkInClientAction(merchantId, stage.target);
    setPending(false);
    if ("error" in res) return toast.error(res.error);
    if (res.alreadyToday) {
      toast("Already checked in today");
      setStage({ kind: "client", client: res.client, target: stage.target });
      return;
    }
    setStage({ kind: "done", client: res.client, points: res.points });
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
        <p className="text-[16px] font-semibold">{stage.client.name} is checked in</p>
        <p className="text-[13px] text-ink-muted">
          {stage.points > 0 ? `+${stage.points} points · ` : ""}
          {stage.client.points} points · visit {stage.client.visits}
        </p>
        <div className="mt-2 flex w-full gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Done
          </Button>
          <Button className="flex-1" onClick={() => setStage({ kind: "scanning" })}>
            Next client
          </Button>
        </div>
      </div>
    );
  }

  if (stage.kind === "client") {
    const c = stage.client;
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold">{c.name}</p>
              {c.email && <p className="truncate text-[12px] text-ink-muted">{c.email}</p>}
            </div>
            {c.membership ? <Pill tone="green">{c.membership}</Pill> : <Pill>Not a member</Pill>}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <dt className="text-ink-muted">Points</dt>
              <dd className="tabular text-[16px] font-semibold">{c.points}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Visits</dt>
              <dd className="tabular text-[16px] font-semibold">{c.visits}</dd>
            </div>
          </dl>
        </div>
        {c.checkedInToday ? (
          <p className="rounded-[10px] bg-app px-3 py-2 text-center text-[13px] text-ink-muted">Already checked in today.</p>
        ) : (
          <Button className="w-full" onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Check in{c.pointsPerVisit > 0 ? ` · +${c.pointsPerVisit} points` : ""}
          </Button>
        )}
        <Button variant="ghost" className="w-full" onClick={() => setStage({ kind: "scanning" })}>
          Scan someone else
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex rounded-[10px] border border-border p-0.5 text-[12px]" role="tablist">
        {(["scanning", "searching"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={stage.kind === k}
            onClick={() => setStage({ kind: k })}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-1.5 ${stage.kind === k ? "bg-primary-soft font-medium text-primary" : "text-ink-muted"}`}
          >
            {k === "scanning" ? <Camera className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
            {k === "scanning" ? "Scan code" : "Find by name"}
          </button>
        ))}
      </div>
      {stage.kind === "scanning" ? (
        <CameraScanner onCode={onCode} onUnavailable={toSearch} />
      ) : (
        <ClientSearch merchantId={merchantId} onPick={(id) => void lookup({ customerProfileId: id })} />
      )}
    </div>
  );
}

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Reads QR codes from the camera. Uses the browser's own BarcodeDetector when
 * it has one, and falls back to jsQR (loaded only then) — iPhone Safari, the
 * likeliest front-desk device, has no BarcodeDetector.
 */
function CameraScanner({ onCode, onUnavailable }: { onCode: (value: string) => void; onUnavailable: () => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(true);

  React.useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem("This browser can't use a camera here. Find the client by name instead.");
        setStarting(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (err) {
        const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
        setProblem(denied ? "Camera access was blocked. Allow it in the browser's site settings, or find the client by name." : "No camera found. Find the client by name instead.");
        setStarting(false);
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setStarting(false);

      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      let detector: Detector | null = null;
      if (Native) {
        try {
          detector = new Native({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      async function tick() {
        if (stopped) return;
        try {
          if (video.readyState >= 2) {
            let value: string | undefined;
            if (detector) {
              value = (await detector.detect(video))[0]?.rawValue;
            } else if (jsQR && ctx) {
              // Downscale: plenty of pixels for a phone-screen QR, far less work.
              const scale = Math.min(1, 640 / (video.videoWidth || 640));
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              value = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
            }
            if (value) {
              stopped = true;
              onCode(value);
              return;
            }
          }
        } catch {
          /* a bad frame; try the next one */
        }
        timer = setTimeout(tick, 150);
      }
      void tick();
    }

    void start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  if (problem) {
    return (
      <div className="space-y-3 py-4 text-center">
        <p className="text-[13px] text-ink-muted">{problem}</p>
        <Button variant="outline" onClick={onUnavailable}>
          <Search className="h-3.5 w-3.5" /> Find by name
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-card bg-[var(--text-primary)]">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        {/* Viewfinder */}
        <div className="pointer-events-none absolute inset-[18%] rounded-[18px] border-2 border-white/80" aria-hidden="true" />
        {starting && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
      </div>
      <p className="text-center text-[12px] text-ink-muted">Ask the client to open the Scan tab and hold up their phone.</p>
    </div>
  );
}

function ClientSearch({ merchantId, onPick }: { merchantId: string; onPick: (customerProfileId: string) => void }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ customerProfileId: string; name: string; email: string | null }[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let current = true;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await searchClientsForCheckInAction(merchantId, q);
      if (!current) return;
      setLoading(false);
      if ("error" in res) return toast.error(res.error);
      setResults(res.results);
    }, 250);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [q, merchantId]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, email or phone"
          aria-label="Search clients"
          className="h-10 w-full rounded-[10px] border border-border bg-surface pl-8 pr-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>
      {loading && <p className="text-[12px] text-ink-muted">Searching…</p>}
      {!loading && q.trim().length >= 2 && results.length === 0 && <p className="text-[12px] text-ink-muted">No clients match.</p>}
      <ul className="divide-y divide-border rounded-card border border-border empty:hidden">
        {results.map((r) => (
          <li key={r.customerProfileId}>
            <button type="button" onClick={() => onPick(r.customerProfileId)} className="w-full px-4 py-2.5 text-left hover:bg-app">
              <span className="block text-[13px] font-medium">{r.name}</span>
              {r.email && <span className="block text-[11px] text-ink-muted">{r.email}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
