import type { NextConfig } from "next";

/**
 * Security headers live here rather than in `netlify.toml`.
 *
 * Next.js applies them on every host, so the app is protected identically on Vercel,
 * Netlify or a plain Node server — one source of truth instead of a per-platform file
 * that silently stops applying when the host changes.
 *
 * The two rules deliberately use **disjoint** header keys. Next.js merges every matching
 * rule, so repeating a key across rules would emit it twice; splitting them this way
 * means `/api/*` receives the cache header from rule 1 and the security headers from
 * rule 2, with nothing duplicated.
 */

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts, so 'unsafe-inline' is required.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      // Every outbound call goes through our own routes — the TeleBotHost key and the
      // model key never leave the server-side proxy, so no third-party origin is needed.
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [
      {
        // Proxy responses carry the user's credentials in a header, so they must never
        // be cached by a CDN or the browser.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
