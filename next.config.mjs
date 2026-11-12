import createNextIntlPlugin from "next-intl/plugin";

/**
 * No URL-based locale routing (no /nl or /en prefix) — the three surfaces
 * already have their own path structure, and locale is a per-account or
 * per-clinic setting, not something a URL segment should carry. i18n/request.ts
 * is where locale is actually resolved.
 */
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * One id per build. The service worker caches Next's fingerprinted files
 * forever, so its cache has to be thrown away when a new build replaces them
 * — and the only thing that reliably changes between builds is this.
 */
const buildId = process.env.BUILD_ID || String(Date.now());

/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: () => buildId,
  // No "X-Powered-By: Next.js" on every response. It protects nothing by
  // itself, but there is no reason to tell every scanner which framework —
  // and so which advisories — to try first.
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  eslint: {
    dirs: ["app", "components", "lib", "prisma", "server", "tests"],
  },
  // Nothing in this app uses next/image: every picture is a plain <img> of a
  // file we already resized on upload (lib/image-pipeline.ts). The optimiser
  // endpoint exists regardless, and it used to accept any https host on the
  // internet — an open image proxy that anyone could bill to this project,
  // and the endpoint named in a critical Next.js advisory
  // (docs/security/review-2026-11.md, I-1 and D-1). Both lists are empty on
  // purpose: no remote host and no local path, so every request to
  // /_next/image is refused. If next/image is ever adopted, name the one
  // storage host here — never a wildcard.
  images: {
    remotePatterns: [],
    localPatterns: [],
  },
  async headers() {
    return [
      {
        // Apple fetches this to verify the domain for Apple Pay. Next would
        // otherwise serve the extensionless file as a binary download.
        source: "/.well-known/apple-developer-merchantid-domain-association",
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
      },
    ];
  },
  webpack(config) {
    // jose (inside Auth.js) mentions CompressionStream/DecompressionStream for
    // compressed encrypted tokens. Both are standard Web APIs the Edge runtime
    // has, and Auth.js never compresses tokens, but Next's static check still
    // flags them in the middleware bundle. Silence only that module's warning.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules[\\/]jose[\\/]dist[\\/]webapi[\\/]lib[\\/]deflate\.js/, message: /Edge Runtime/ },
    ];
    return config;
  },
};

export default withNextIntl(nextConfig);
