import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={hanken.variable}>
      <body className="min-h-screen antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
