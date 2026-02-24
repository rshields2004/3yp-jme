import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['local-origin.dev', '*.local-origin.dev', '192.168.1.111', '192.168.1.*'],
};

export default nextConfig;
