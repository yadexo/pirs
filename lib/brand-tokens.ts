/**
 * One clinic colour, turned into the handful of roles the design system uses.
 *
 * A clinic picks a single hex. That colour then has to work as a tag fill, as
 * text on a pale tint, as a round button carrying a white icon, and as a
 * banner behind white text — and no single colour does all four. A soft pink
 * is lovely as a tag and illegible as text; a deep navy is the opposite.
 *
 * So the app derives a ramp from the clinic's hue and picks each role by
 * measured contrast rather than by hope. A pale brand steps down to a deeper
 * shade where it needs to carry white; a dark brand stays exactly as the
 * clinic entered it, because it already passes.
 *
 * The maths is done here, in sRGB and OKLCH, rather than in CSS: relative
 * colour syntax (`oklch(from …)`) is too new for the phones this app is
 * installed on, and doing it here means the result can be tested against the
 * contrast rules it claims to meet.
 */

export interface BrandRoles {
  /** The clinic's colour exactly as entered: tags, progress fill, total chip. */
  brand: string;
  /** Pale tint: placeholders, soft badges, member-price highlights. */
  brandSoft: string;
  /** Slightly stronger tint: focus rings, placeholder ripples. */
  brandLine: string;
  /** Readable as text on `brandSoft` and on white: member prices, links. */
  brandStrong: string;
  /** White or ink, whichever is readable on a `brand` fill. */
  onBrand: string;
  /** Dark enough to carry a white icon: the Scan button. */
  brandFillWhite: string;
  /** Dark enough for a large banner with white text. */
  brandDeep: string;
}

/* ---------------------------------------------------------------- colour */

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb | null {
  const cleaned = hex.trim().replace(/^#/, "");
  const full = cleaned.length === 3 ? cleaned.replace(/./g, (c) => c + c) : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function toHex({ r, g, b }: Rgb): string {
  const channel = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** sRGB is gamma-encoded; every calculation below needs it linear first. */
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(clamp01(c), 1 / 2.4) - 0.055);

/** Relative luminance, for the WCAG ratios the roles are chosen by. */
function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/* ------------------------------------------------------------------ oklch */

type Oklch = { l: number; c: number; h: number };

function rgbToOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const chroma = Math.sqrt(okA * okA + okB * okB);
  const hue = ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;
  return { l: okL, c: chroma, h: hue };
}

function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b2 = c * Math.sin(hr);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b2) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b2) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b2) ** 3;

  return {
    r: toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  };
}

/* ------------------------------------------------------------------- ramp */

const WHITE: Rgb = { r: 1, g: 1, b: 1 };
const INK: Rgb = { r: 0x0d / 255, g: 0x0d / 255, b: 0x0d / 255 };

export const INK_HEX = "#0D0D0D";

/**
 * The ramp, as the handoff defines it. 500 is the clinic's own colour; the
 * lighter steps lose chroma so a tint stays a tint, and the darker steps keep
 * it so a deep shade still reads as the brand.
 */
const RAMP: { step: number; of: (base: Oklch) => Oklch }[] = [
  { step: 50, of: (b) => ({ l: 0.975, c: b.c * 0.25, h: b.h }) },
  { step: 100, of: (b) => ({ l: 0.95, c: b.c * 0.4, h: b.h }) },
  { step: 200, of: (b) => ({ l: 0.9, c: b.c * 0.6, h: b.h }) },
  { step: 300, of: (b) => ({ l: 0.82, c: b.c * 0.85, h: b.h }) },
  { step: 500, of: (b) => b },
  { step: 600, of: (b) => ({ l: b.l * 0.86, c: b.c, h: b.h }) },
  { step: 700, of: (b) => ({ l: b.l * 0.72, c: b.c, h: b.h }) },
  { step: 800, of: (b) => ({ l: b.l * 0.6, c: b.c * 0.95, h: b.h }) },
  { step: 900, of: (b) => ({ l: b.l * 0.48, c: b.c * 0.9, h: b.h }) },
];

/** The clinic's colour when it can't be read — amber, as the schema default. */
export const FALLBACK_BRAND = "#F59E0B";

/**
 * Resolves every brand role for one clinic colour.
 *
 * Each role that must be legible walks the ramp from 500 downwards and takes
 * the first shade that measures up. A colour already dark enough stops at
 * 500, which is why a deep green clinic sees its own colour everywhere and a
 * pale pink one sees a deeper rose where white has to sit on it.
 */
export function brandTokens(input: string | null | undefined): BrandRoles {
  const parsed = parseHex(input ?? "") ?? parseHex(FALLBACK_BRAND)!;
  const base = rgbToOklch(parsed);

  const shades = new Map<number, Rgb>();
  for (const { step, of } of RAMP) shades.set(step, step === 500 ? parsed : oklchToRgb(of(base)));
  const at = (step: number) => shades.get(step)!;

  const darkSteps = [500, 600, 700, 800, 900];
  /** The first shade from 500 down that satisfies `ok`, else the darkest. */
  const firstThat = (ok: (rgb: Rgb) => boolean): Rgb => {
    for (const step of darkSteps) {
      const shade = at(step);
      if (ok(shade)) return shade;
    }
    return at(900);
  };

  const soft = at(100);

  return {
    brand: toHex(parsed),
    brandSoft: toHex(soft),
    brandLine: toHex(at(200)),
    // Readable as text both on its own tint and on white, since member prices
    // appear on both.
    brandStrong: toHex(firstThat((shade) => contrast(shade, soft) >= 4.5 && contrast(shade, WHITE) >= 4.5)),
    onBrand: contrast(WHITE, parsed) >= 4.5 ? "#FFFFFF" : INK_HEX,
    // 3:1 is the bar for an icon rather than text.
    brandFillWhite: toHex(firstThat((shade) => contrast(WHITE, shade) >= 3)),
    brandDeep: toHex(firstThat((shade) => rgbToOklch(shade).l <= 0.46)),
  };
}

/** The roles as CSS custom properties, for a style attribute or a stylesheet. */
export function brandCssVars(roles: BrandRoles): Record<string, string> {
  return {
    "--brand": roles.brand,
    "--brand-soft": roles.brandSoft,
    "--brand-line": roles.brandLine,
    "--brand-strong": roles.brandStrong,
    "--on-brand": roles.onBrand,
    "--brand-fill-white": roles.brandFillWhite,
    "--brand-deep": roles.brandDeep,
  };
}

export { INK as INK_RGB, WHITE as WHITE_RGB, parseHex, luminance };
