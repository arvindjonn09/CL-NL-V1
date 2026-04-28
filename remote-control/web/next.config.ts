import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.NEXT_ALLOWED_DEV_ORIGINS
    ? process.env.NEXT_ALLOWED_DEV_ORIGINS.split(",").map((origin) => origin.trim())
    : ["localhost", "127.0.0.1"],
};

export default nextConfig;
