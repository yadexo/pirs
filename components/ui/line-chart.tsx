import { cn } from "@/lib/utils";

/**
 * Thin flat line chart — 2px stroke, no fill, no gridlines beyond a faint
 * baseline. Pure SVG so it renders on the server with no client JS.
 */
export function LineChart({
  points,
  xLabels,
  className,
  height = 120,
  banded = false,
}: {
  points: number[];
  xLabels?: string[];
  className?: string;
  height?: number;
  /** Faint alternating vertical bands, used on Daily processing. */
  banded?: boolean;
}) {
  const width = 600;
  const padY = 8;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;

  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((value, i) => {
    const x = i * step;
    const y = padY + (height - padY * 2) * (1 - (value - min) / span);
    return { x, y };
  });

  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const allZero = points.every((p) => p === 0);

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {banded &&
          points.map((_, i) =>
            i % 2 === 0 ? (
              <rect key={i} x={i * step} y={0} width={step} height={height} fill="var(--bg-app)" opacity={0.6} />
            ) : null,
          )}
        <line x1={0} y1={height - padY} x2={width} y2={height - padY} stroke="var(--border)" strokeWidth={1} />
        {!allZero && (
          <>
            <path d={path} fill="none" stroke="var(--chart-line)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {coords.map((c, i) => (
              <circle key={i} cx={c.x} cy={c.y} r={2.5} fill="var(--chart-line)" vectorEffect="non-scaling-stroke" />
            ))}
          </>
        )}
      </svg>
      {xLabels && (
        <div className={cn("mt-1.5 flex justify-between text-[10px] text-ink-faint")}>
          {xLabels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}
