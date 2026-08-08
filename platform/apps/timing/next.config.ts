import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const nextConfig: NextConfig = {
  // `packages/shared` ships TypeScript rather than built JavaScript, so Next has to
  // compile it. This is the workspace equivalent of an import, and it is why the club
  // gets one `Europe/London` module instead of two that drift.
  transpilePackages: ['@src/shared', '@src/db'],

  typedRoutes: true,
};

// Makes Worker bindings available under `next dev`, so the fast loop sees what the real
// runtime sees rather than a Node approximation.
//
// **Guarded, and the guard is not optional.** This spawns a Miniflare/workerd instance as
// a side effect of loading the config — and `next build` loads the config again in every
// static-generation worker, so calling it unconditionally fans out into repeated workerd
// spawns and will take a laptop down. It belongs in `next dev` and nowhere else.
if (process.env.NODE_ENV === 'development') {
  void initOpenNextCloudflareForDev();
}

export default nextConfig;
