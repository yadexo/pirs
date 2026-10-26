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
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  eslint: {
    dirs: ["app", "components", "lib", "prisma", "server", "tests"],
  },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: "**" },
    ],
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
