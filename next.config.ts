import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a Node builtin; keep it out of the bundler's hands.
  serverExternalPackages: ["node:sqlite"],
  experimental: {
    // Sightings can carry a user photo; keep the server action limit generous.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
