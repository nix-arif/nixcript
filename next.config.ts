import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    authInterrupts: true,
    staleTimes: {
      dynamic: 0,   // 0 = disable client Router Cache for dynamic pages — loading.tsx fires on every navigation
      static: 180,
    },
  },
  serverExternalPackages: ["pdfjs-dist", "pdf-parse"],
  allowedDevOrigins: [
    "192.168.0.*",
    "192.168.1.*",
    "10.0.0.*",
    "172.20.10.*",
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-ff11f3d299444d7497bde72661d333a2.r2.dev",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "pub-6799abb2e3684a44b54f26d064114eb7.r2.dev",
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
