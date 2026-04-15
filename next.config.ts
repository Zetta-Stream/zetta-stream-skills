import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      {
        source: "/agent-api/:path*",
        destination: `${process.env.NEXT_PUBLIC_AGENT_API_URL ?? "http://localhost:7777"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
