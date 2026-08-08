import type { Config } from "tailwindcss";

/**
 * Every value maps to a CSS variable in app/globals.css. Adding a raw hex
 * here (or in a component) defeats the token system — extend globals.css
 * instead and reference it from this file.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "var(--bg-app)",
        surface: "var(--bg-surface)",
        border: "var(--border)",
        ink: {
          DEFAULT: "var(--text-primary)",
          muted: "var(--text-muted)",
          faint: "var(--text-faint)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          hover: "var(--primary-hover)",
          soft: "var(--primary-soft)",
        },
        accent: {
          purple: "var(--accent-purple)",
          indigo: "var(--accent-indigo)",
          green: "var(--accent-green)",
          amber: "var(--accent-amber)",
          red: "var(--accent-red)",
          cyan: "var(--accent-cyan)",
          pink: "var(--accent-pink)",
        },
        chart: "var(--chart-line)",
      },
      borderRadius: {
        card: "var(--radius-card)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
      fontSize: {
        "page-title": ["26px", { lineHeight: "32px", fontWeight: "600" }],
        "card-title": ["14px", { lineHeight: "20px", fontWeight: "500" }],
        metric: ["24px", { lineHeight: "30px", fontWeight: "600" }],
        label: ["11px", { lineHeight: "16px" }],
      },
    },
  },
  plugins: [],
};

export default config;
