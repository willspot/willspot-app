import type { NextConfig } from "next";

// Static export: the marketing site is plain files on a CDN. Security headers
// (CSP, HSTS, frame-ancestors) are set at the CDN / web server — see docs/SECURITY.md.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
