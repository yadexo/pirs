"use client";

/**
 * Last-resort boundary for errors in the root layout itself, where no other
 * error page can render. The error is already reported server-side through
 * instrumentation.ts (onRequestError); this only offers a way back.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main style={{ maxWidth: 360, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#64748b" }}>The error has been recorded. Please try again.</p>
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: "10px 18px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
