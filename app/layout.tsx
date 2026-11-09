import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./design-tokens.css";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

/**
 * The one typeface both apps use, served from our own origin.
 *
 * The files are committed (app/fonts/, SIL Open Font License — see the README
 * there). They used to be fetched from Google at build time by
 * next/font/google, which meant every build depended on a network call to
 * fonts.googleapis.com: a Vercel build failed outright when that call came
 * back in a shape the loader could not read ("Cannot read properties of null
 * (reading '1')"). A build should not be able to fail because somebody else's
 * CDN had a bad minute. Nothing about what the browser receives changed —
 * next/font self-hosted the files either way.
 *
 * One variable font covering 400–800, in the same per-script subsets Google
 * cut, and the same ones next/font/google was already serving. next/font/local
 * has no unicode-range, so instead of one family with four ranges there are
 * four families listed in order in --font-ui (app/design-tokens.css):
 * CSS falls back per character, so a Polish ł or a Cyrillic д still finds its
 * glyph in the next family along. Only latin is preloaded — exactly what
 * happened before — and the rest are fetched only if a page actually renders
 * a character from them.
 */
// Spelled out one call at a time, with no shared options object and no
// helper: next/font reads these arguments statically at build time, and a
// spread or a variable is a build error ("Unexpected spread"), not a runtime
// one. Keep them literal.
//
// adjustFontFallback: false on every one of them, and it has to be. Left on,
// next/font appends a metric-matched Arial to each family — "hanken Fallback"
// — inside that family's own CSS variable. That fallback covers the whole of
// Latin, so it would answer for a ł before the latin-ext cut below ever got
// asked, and the per-character cascade this depends on would quietly stop
// working. The cost is a little more layout shift while the latin file loads,
// which preload plus font-display: swap already keep small.
const hanken = localFont({
  src: "./fonts/hanken-grotesk-latin.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-hanken",
  preload: true,
  adjustFontFallback: false,
});
const hankenLatinExt = localFont({
  src: "./fonts/hanken-grotesk-latin-ext.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-hanken-latin-ext",
  preload: false,
  adjustFontFallback: false,
});
const hankenVietnamese = localFont({
  src: "./fonts/hanken-grotesk-vietnamese.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-hanken-vietnamese",
  preload: false,
  adjustFontFallback: false,
});
const hankenCyrillicExt = localFont({
  src: "./fonts/hanken-grotesk-cyrillic-ext.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-hanken-cyrillic-ext",
  preload: false,
  adjustFontFallback: false,
});

const fontVariables = [hanken, hankenLatinExt, hankenVietnamese, hankenCyrillicExt].map((f) => f.variable).join(" ");

export const metadata: Metadata = {
  title: "Clinic Engagement Platform",
  description: "White-label sales, loyalty, membership, and engagement platform for clinics and practices.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved server-side (i18n/request.ts), same value the page itself was
  // rendered with — see lib/locale.ts for why this is never auto-detected.
  const locale = await getLocale();
  return (
    <html lang={locale} className={fontVariables}>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
