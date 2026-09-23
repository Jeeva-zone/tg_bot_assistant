import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The TeleBotHost API is always called from our own server routes, never
  // straight from the browser, so no client-side CORS workarounds are needed.
  poweredByHeader: false,
};

export default nextConfig;
