import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    authInterrupts: true,
  },
  serverExternalPackages: ["pdfjs-dist", "pdf-parse"],
  allowedDevOrigins: [
    "192.168.0.*", // your local network range
    "192.168.1.*", // common router range
    "10.0.0.*", // some routers use this
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-ff11f3d299444d7497bde72661d333a2.r2.dev",
        pathname: "/**",
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
