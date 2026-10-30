"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/primitives";
import type { CropRect } from "@/lib/client-image";

/**
 * Choosing which part of a photo to keep.
 *
 * Product and offer photos are stored at one shape so a shop page is a grid
 * rather than a ransom note, and the clinic — not a centre-crop — decides
 * what that shape contains. A bottle photographed off-centre was the case
 * that made this worth having.
 *
 * The maths is the same idea as `object-fit: cover`: the image is scaled to
 * cover the frame at zoom 1, and dragging moves it behind a fixed window.
 * What comes back is a rectangle in the source image's own pixels, so the
 * browser's downscale and the server's resize both work from the original.
 */

export interface CropChoice {
  crop: CropRect;
  aspect: number;
}

const FRAME_WIDTH = 320;
const MAX_ZOOM = 4;

export function ImageCrop({
  file,
  aspects,
  onDone,
}: {
  file: File;
  /** The shapes offered; the first is the default. */
  aspects: number[];
  /** Null when the clinic backs out — that file is then skipped. */
  onDone: (choice: CropChoice | null) => void;
}) {
  const t = useTranslations("merchant.form");
  const [url, setUrl] = React.useState<string | null>(null);
  const [natural, setNatural] = React.useState<{ width: number; height: number } | null>(null);
  const [aspect, setAspect] = React.useState(aspects[0] ?? 1);
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  React.useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const frameHeight = Math.round(FRAME_WIDTH / aspect);

  // Scale that makes the image cover the frame, before the clinic zooms in.
  const baseScale = natural ? Math.max(FRAME_WIDTH / natural.width, frameHeight / natural.height) : 1;
  const scale = baseScale * zoom;
  const shownWidth = natural ? natural.width * scale : 0;
  const shownHeight = natural ? natural.height * scale : 0;

  /** Keeps the frame covered: the image may not be dragged away from an edge. */
  const clamp = React.useCallback(
    (next: { x: number; y: number }) => ({
      x: Math.min(0, Math.max(FRAME_WIDTH - shownWidth, next.x)),
      y: Math.min(0, Math.max(frameHeight - shownHeight, next.y)),
    }),
    [shownWidth, shownHeight, frameHeight],
  );

  // Re-centre whenever the shape or the zoom changes the frame underneath it.
  React.useEffect(() => {
    if (!natural) return;
    setOffset(() => clamp({ x: (FRAME_WIDTH - shownWidth) / 2, y: (frameHeight - shownHeight) / 2 }));
  }, [natural, aspect, zoom, clamp, shownWidth, shownHeight, frameHeight]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    setOffset(clamp({ x: start.ox + (e.clientX - start.x), y: start.oy + (e.clientY - start.y) }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  }

  function confirm() {
    if (!natural) return;
    onDone({
      aspect,
      // Back into the source image's own pixels, which is what both the
      // browser's downscale and the server's resize work from.
      crop: {
        x: Math.max(0, Math.round(-offset.x / scale)),
        y: Math.max(0, Math.round(-offset.y / scale)),
        width: Math.min(natural.width, Math.round(FRAME_WIDTH / scale)),
        height: Math.min(natural.height, Math.round(frameHeight / scale)),
      },
    });
  }

  const label = (value: number) => (Math.abs(value - 1) < 0.01 ? t("cropAspect11") : t("cropAspect43"));

  return (
    <Drawer open onClose={() => onDone(null)} title={t("cropTitle")} subtitle={t("cropHint")}>
      <div className="space-y-4">
        {aspects.length > 1 && (
          <div className="flex gap-2">
            {aspects.map((value) => (
              <Button key={value} size="sm" variant={value === aspect ? "primary" : "outline"} onClick={() => setAspect(value)}>
                {label(value)}
              </Button>
            ))}
          </div>
        )}

        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ width: FRAME_WIDTH, height: frameHeight }}
          className="relative mx-auto touch-none overflow-hidden rounded-[10px] border border-border bg-app"
        >
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              style={{ width: shownWidth || undefined, height: shownHeight || undefined, transform: `translate(${offset.x}px, ${offset.y}px)` }}
              className="max-w-none origin-top-left select-none"
            />
          )}
        </div>

        <label className="flex items-center gap-3 text-[12px] text-ink-muted">
          {t("cropZoom")}
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-[var(--ink)]"
          />
        </label>

        <div className="flex gap-2">
          <Button onClick={confirm} disabled={!natural} className="flex-1">
            {t("cropConfirm")}
          </Button>
          <Button variant="outline" onClick={() => onDone(null)}>
            {t("cropCancel")}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
