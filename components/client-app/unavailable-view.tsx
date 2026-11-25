/**
 * A clinic's app while the clinic is suspended: its own logo and name, and
 * that the app is temporarily unavailable. Nothing about why.
 * (tests/integration/unavailable-and-not-found.test.ts)
 */
export function UnavailableView({ name, logoUrl, title, body }: { name: string; logoUrl: string | null; title: string; body: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={name} className="h-14 w-auto object-contain" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-tile)] bg-[var(--black)] text-[20px] font-bold text-white">
          {name.charAt(0)}
        </span>
      )}
      <h1 className="mt-6 text-[27px] font-bold leading-tight text-[var(--ink-strong)]">{title}</h1>
      <p className="mt-3 max-w-[32ch] text-[16px] leading-snug text-[var(--muted)]">{body}</p>
    </main>
  );
}
