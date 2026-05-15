import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  // typedRoutes is opt-in but currently rejects Clerk's catch-all sign-in path
  // ('/sign-in/[[...sign-in]]/page.tsx') when passed to redirect(). Leave it
  // off until the dashboard's link surface is stable enough to benefit from
  // type-safe routes.
  typedRoutes: false,
};

export default config;
