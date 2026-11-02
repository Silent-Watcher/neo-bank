import type { NextConfig } from 'next';

// `standalone` produces a self-contained server bundle for the production
// Docker image (apps/web/Dockerfile.prod) — no node_modules or build
// toolchain in the runtime stage. Development behavior is unchanged.
const nextConfig: NextConfig = {
  output: 'standalone',
};

export default nextConfig;
