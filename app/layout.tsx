import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./design-tokens.css";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

/**
 * The one typeface both apps use. next/font downloads it at build time and
 * serves it from our own origin, so there is no request to Google at runtime
 * and no flash of a fallback.
 */
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clinic Engagement Platform",
  description: "White-label sales, loyalty, membership, and engagement platform for clinics and practices.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved server-side (i18n/request.ts), same value the page itself was
  // rendered with — see lib/locale.ts for why this is never auto-detected.
  const locale = await getLocale();
  return (
    <html lang={locale} className={hanken.variable}>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
