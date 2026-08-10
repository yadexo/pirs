"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ icons */

const S = (d: string, size = 24, w = 1.7) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const PATHS: Record<string, string> = {
  home: '<path d="M4 10.6 12 3.6l8 7"/><path d="M6 9.6V20a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.6"/><path d="M9.4 14.4c.7 1 1.6 1.5 2.6 1.5s1.9-.5 2.6-1.5"/>',
  bag: '<path d="M6.5 8h11l-1.1 12.2a1 1 0 0 1-1 .8H8.6a1 1 0 0 1-1-.8L6.5 8z"/><path d="M9.2 8V6.4a2.8 2.8 0 0 1 5.6 0V8"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7.5 12h9"/>',
  gift: '<path d="M5 9.5h14V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9.5z"/><path d="M3.5 6.5h17v3h-17z"/><path d="M12 6.5V21"/><path d="M12 6.3C10.2 3.4 6.2 3.7 6.7 6c.3 1.4 2.4 1.6 5.3.3z"/><path d="M12 6.3c1.8-2.9 5.8-2.6 5.3-.3-.3 1.4-2.4 1.6-5.3.3z"/>',
  user: '<circle cx="12" cy="7.2" r="3.4"/><path d="M5 20c.9-3.7 3.5-5.6 7-5.6s6.1 1.9 7 5.6"/>',
  search: '<circle cx="11" cy="11" r="6.3"/><path d="m15.8 15.8 4.7 4.7"/>',
  chevR: '<path d="m9.5 6 6 6-6 6"/>',
  chevD: '<path d="m6 9.5 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M8 6.5V5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 5v1.5"/><path d="M6.5 6.5 7.4 20a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13.5"/>',
  exit: '<path d="M13 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6"/><path d="M4 12h10"/><path d="m10 8 4 4-4 4"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18"/>',
  sliders: '<path d="M5 7h8"/><circle cx="16.5" cy="7" r="2.2"/><path d="M5 16h2M12 16h7"/><circle cx="9.5" cy="16" r="2.2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  phone: '<path d="M7.2 3.9 9 3.3a1 1 0 0 1 1.2.6l1 2.6a1 1 0 0 1-.3 1.2L9.4 9a12.4 12.4 0 0 0 5.6 5.6l1.3-1.5a1 1 0 0 1 1.2-.3l2.6 1a1 1 0 0 1 .6 1.2l-.6 1.8a1.7 1.7 0 0 1-1.7 1.2C11 18 6 13 5.5 5.6A1.7 1.7 0 0 1 7.2 3.9z"/>',
  pin: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  share: '<path d="M12 3.5V14"/><path d="m8.5 7 3.5-3.5L15.5 7"/><path d="M7 10.5H6A1.5 1.5 0 0 0 4.5 12v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1"/>',
  sparkle: '<path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18.2l-1.8-5.6L4.7 10.8 10.2 9z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.8-3.3 3-5 5.5-5s4.7 1.7 5.5 5"/><path d="M15.5 5.4a3.2 3.2 0 0 1 0 5.9"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20 14v.01M17 20h3M14 20v.01"/>',
  bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
  tag: '<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  shield: '<path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 8.2 7 9.2 4.1-1 7-4.9 7-9.2V6.2Z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.4 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.4-3.3-8.5S9.8 5.9 12 3.5Z"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4"/><path d="M12 16.8v.01"/>',
};

export function Icon({ name, size = 24, width }: { name: keyof typeof PATHS | string; size?: number; width?: number }) {
  const d = PATHS[name] ?? PATHS.help!;
  return <span dangerouslySetInnerHTML={{ __html: S(d, size, width) }} />;
}

export function Scribble() {
  return (
    <svg width="140" height="86" viewBox="0 0 150 92" fill="none" stroke="#D6DAE1" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <ellipse cx="38" cy="30" rx="26" ry="14" />
      <ellipse cx="52" cy="52" rx="22" ry="12" />
      <ellipse cx="40" cy="72" rx="16" ry="9" />
      <path d="M92 26c8-4 16-4 24 0M96 44c10-5 20-5 30 0M92 62c8-4 16-4 24 0" />
    </svg>
  );
}

/* --------------------------------------------------------------- helpers */

export const money = (cents: number, currency = "EUR") => {
  const v = cents / 100;
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return sym + (Number.isInteger(v) ? v : v.toFixed(2));
};

function mulberry(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s: string) {
  let h = 1779033703;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/* ---------------------------------------------------------- GlossSurface */

export function Gloss({
  className,
  particles,
  bevel,
  seed = "gloss",
  style,
  children,
}: {
  className?: string;
  particles?: boolean;
  bevel?: boolean;
  seed?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const dots = React.useMemo(() => {
    if (!particles) return [];
    const rng = mulberry(hashStr(seed));
    return Array.from({ length: 26 }, () => ({
      left: `${(rng() * 100).toFixed(1)}%`,
      top: `${(rng() * 100).toFixed(1)}%`,
      w: rng() > 0.5 ? 2 : 1,
      o: (0.2 + rng() * 0.2).toFixed(2),
    }));
  }, [particles, seed]);

  return (
    <div className={cn("gloss", bevel && "bevel", className)} style={style}>
      <span className="grain" />
      {particles && (
        <span className="pts" aria-hidden="true">
          {dots.map((d, i) => (
            <span key={i} className="pt" style={{ left: d.left, top: d.top, width: d.w, height: 2, opacity: Number(d.o) }} />
          ))}
        </span>
      )}
      <div className="gcontent">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------- QR */

export function QrCode({ value }: { value: string }) {
  const rects = React.useMemo(() => {
    const n = 25;
    const rng = mulberry(hashStr(value));
    const out: { x: number; y: number }[] = [];
    const put = (r: number, c: number) => out.push({ x: c, y: r });
    const reserved = (r: number, c: number) =>
      (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8) || r === 6 || c === 6 || (r >= 16 && r <= 20 && c >= 16 && c <= 20);
    const finder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 7; c++) {
          const edge = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          if (edge || core) put(r0 + r, c0 + c);
        }
    };
    finder(0, 0);
    finder(0, n - 7);
    finder(n - 7, 0);
    for (let i = 8; i < n - 8; i++) if (i % 2 === 0) { put(6, i); put(i, 6); }
    for (let r = 16; r <= 20; r++)
      for (let c = 16; c <= 20; c++) {
        const a = r - 16, b = c - 16;
        if (a === 0 || a === 4 || b === 0 || b === 4 || (a === 2 && b === 2)) put(r, c);
      }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!reserved(r, c) && rng() > 0.52) put(r, c);
    return out;
  }, [value]);

  return (
    <svg viewBox="0 0 25 25" fill="var(--ink-strong)" shapeRendering="crispEdges" role="img" aria-label="Member QR code">
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width="1" height="1" />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------- bottom sheet */

export function Sheet({
  open,
  onClose,
  title,
  full,
  children,
  cta,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  full?: boolean;
  children?: React.ReactNode;
  cta?: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [dragY, setDragY] = React.useState(0);
  const startY = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
    setMounted(false);
    setDragY(0);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={cn("sheetWrap", mounted && "in")}>
      <div className="sback" onClick={onClose} aria-hidden="true" />
      <div
        className={cn("sheet", full && "full")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragY ? "none" : undefined }}
      >
        <div
          className="grab"
          onPointerDown={(e) => {
            startY.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (startY.current === null) return;
            setDragY(Math.max(0, e.clientY - startY.current));
          }}
          onPointerUp={() => {
            if (dragY > 110) onClose();
            setDragY(0);
            startY.current = null;
          }}
        />
        <div className="sheet-body">
          {title && <div className="sheet-title">{title}</div>}
          {children}
          {cta && <div className="sticky-cta">{cta}</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */

interface ToastCtx {
  toast: (msg: string) => void;
}
const ToastContext = React.createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => React.useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<{ id: number; msg: string; in: boolean }[]>([]);

  const toast = React.useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p, { id, msg, in: false }]);
    requestAnimationFrame(() => setItems((p) => p.map((t) => (t.id === id ? { ...t, in: true } : t))));
    setTimeout(() => setItems((p) => p.map((t) => (t.id === id ? { ...t, in: false } : t))), 2400);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), 2700);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toastRoot">
        {items.map((t) => (
          <div key={t.id} className={cn("toast", t.in && "in")}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------- primitives */

export function EmptyState({ text, sub, cta }: { text: string; sub?: string; cta?: React.ReactNode }) {
  return (
    <div className="scribble">
      <Scribble />
      <p>{text}</p>
      {sub && <p style={{ fontSize: 14, marginTop: -8 }}>{sub}</p>}
      {cta}
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 99 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <span className="stepper">
      <button type="button" aria-label="Decrease" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Icon name="minus" size={18} />
      </button>
      <b className="tabular">{value}</b>
      <button type="button" aria-label="Increase" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Icon name="plus" size={18} />
      </button>
    </span>
  );
}

export function Carousel({ images, alt }: { images: string[]; alt: string }) {
  const [i, setI] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  if (images.length === 0) return null;

  return (
    <>
      <div
        ref={ref}
        className="carousel"
        onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
      >
        {images.map((src, n) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={n} src={src} alt={alt} loading="lazy" />
        ))}
      </div>
      {images.length > 1 && (
        <div className="cdots">
          {images.map((_, n) => (
            <i key={n} className={n === i ? "on" : undefined} />
          ))}
        </div>
      )}
    </>
  );
}

/** Counts up to a value; respects reduced motion. */
export function CountUp({ to, className }: { to: number; className?: string }) {
  const [n, setN] = React.useState(to);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span className={cn("tabular", className)}>{n.toLocaleString()}</span>;
}
