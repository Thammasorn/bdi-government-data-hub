import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle for the production Docker image.
  output: "standalone",
};

export default nextConfig;
