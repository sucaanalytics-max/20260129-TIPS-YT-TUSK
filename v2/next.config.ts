import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  experimental: {
    typedRoutes: true,
  },
};

export default config;
