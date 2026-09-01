import type { NextConfig } from 'next';
import { REDIRECTS } from './components/shell/nav-model';

const config: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  // typedRoutes is opt-in but currently rejects Clerk's catch-all sign-in path
  // ('/sign-in/[[...sign-in]]/page.tsx') when passed to redirect(). Leave it
  // off until the dashboard's link surface is stable enough to benefit from
  // type-safe routes.
  typedRoutes: false,

  /**
   * The redesign collapses fourteen routes into four tabs. Every retired path
   * permanently redirects to the tab that absorbed it, so existing bookmarks
   * and any link sitting in someone's notes keep resolving.
   *
   * The map is derived from `absorbs` in components/shell/nav-model.ts rather
   * than restated here — one record of where each page went, so the nav and the
   * redirects cannot disagree about it.
   */
  async redirects() {
    return REDIRECTS.map((r) => ({ ...r, permanent: true }));
  },
};

export default config;
