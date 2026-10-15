/**
 * The iPhone screen sizes Safari recognises for `apple-touch-startup-image`
 * (portrait only — this app is phone-portrait throughout, see
 * lib/client-app-viewport.ts). Covers SE through the current generation;
 * several recent models share a resolution with an older one, so this list
 * is already de-duplicated by pixel size rather than by device name.
 *
 * iOS matches the `media` attribute against the device, not the file, so the
 * exact numbers here matter — these are Apple's own published values.
 */
export interface LaunchImageSize {
  /** CSS pixels, i.e. what the `media` query is written in. */
  cssWidth: number;
  cssHeight: number;
  dpr: 2 | 3;
}

export const LAUNCH_IMAGE_SIZES: LaunchImageSize[] = [
  { cssWidth: 320, cssHeight: 568, dpr: 2 }, // SE (1st gen)
  { cssWidth: 375, cssHeight: 667, dpr: 2 }, // 6/7/8, SE (2nd/3rd gen)
  { cssWidth: 414, cssHeight: 896, dpr: 2 }, // 11, XR
  { cssWidth: 375, cssHeight: 812, dpr: 3 }, // X, XS, 11 Pro
  { cssWidth: 414, cssHeight: 896, dpr: 3 }, // 11 Pro Max, XS Max
  { cssWidth: 360, cssHeight: 780, dpr: 3 }, // 12 mini, 13 mini
  { cssWidth: 390, cssHeight: 844, dpr: 3 }, // 12, 13, 14
  { cssWidth: 393, cssHeight: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16
  { cssWidth: 428, cssHeight: 926, dpr: 3 }, // 12 Pro Max, 13 Pro Max
  { cssWidth: 430, cssHeight: 932, dpr: 3 }, // 14 Plus/Pro Max, 15 Plus/Pro Max, 16 Plus
  { cssWidth: 402, cssHeight: 874, dpr: 3 }, // 16 Pro
  { cssWidth: 440, cssHeight: 956, dpr: 3 }, // 16 Pro Max
];

export interface LaunchImagePixels {
  width: number;
  height: number;
}

export function pixelSize(s: LaunchImageSize): LaunchImagePixels {
  return { width: s.cssWidth * s.dpr, height: s.cssHeight * s.dpr };
}

/** "750x1334" — the file's own name, independent of which device(s) share it. */
export function launchImageFileName({ width, height }: LaunchImagePixels): string {
  return `${width}x${height}.png`;
}

/** The exact media query Safari expects on the <link>, portrait only. */
export function launchImageMedia(s: LaunchImageSize): string {
  return `(device-width: ${s.cssWidth}px) and (device-height: ${s.cssHeight}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`;
}

/** Every pixel size this app generates images for, de-duplicated. */
export function allLaunchImagePixelSizes(): LaunchImagePixels[] {
  const seen = new Map<string, LaunchImagePixels>();
  for (const s of LAUNCH_IMAGE_SIZES) {
    const px = pixelSize(s);
    seen.set(launchImageFileName(px), px);
  }
  return [...seen.values()];
}

/** Parses "750x1334.png" back into pixel dimensions this app actually generates. */
export function parseLaunchImageFile(file: string): LaunchImagePixels | null {
  const m = /^(\d+)x(\d+)\.png$/.exec(file);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  const known = allLaunchImagePixelSizes().some((p) => p.width === width && p.height === height);
  return known ? { width, height } : null;
}
