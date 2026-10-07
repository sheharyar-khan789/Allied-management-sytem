import type { NextConfig } from "next";
import path from "path";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework/version.
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(__dirname),
  serverExternalPackages: ["jose", "jwks-rsa"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  async headers() {
    const securityHeaders = [
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      },
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
      {
        key: "X-DNS-Prefetch-Control",
        value: "off",
      },
      // Baseline CSP for any route the middleware doesn't match (static assets, public pages).
      // Middleware sets the full nonce-based policy on every page and API route it handles.
      {
        key: "Content-Security-Policy",
        value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
      },
    ];

    if (isProd) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // API responses carry personal data (children's records, fees, payroll): never cached by
        // browsers or shared caches.
        source: "/api/:path*",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      ...["admin", "teacher", "student", "parent", "print"].map((segment) => ({
        source: `/${segment}/:path*`,
        headers: [
          ...securityHeaders,
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
          {
            key: "Cache-Control",
            value: "private, no-store",
          },
        ],
      })),
    ];
  },
};

export default nextConfig;
