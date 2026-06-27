// Cadence — Worker entry point
import api, { runAlerts } from './api';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API routes
    if (url.pathname.startsWith('/api/')) {
      return api.fetch(request, env, ctx);
    }

    // Static assets (configured via [assets] in wrangler.toml)
    if (env.ASSETS) {
      const resp = await env.ASSETS.fetch(request);
      if (resp.status !== 404) return resp;
    }

    // SPA fallback: serve index.html for unknown routes (single-page app)
    if (env.ASSETS) {
      const indexReq = new Request(new URL('/index.html', url), request);
      const indexResp = await env.ASSETS.fetch(indexReq);
      if (indexResp.status === 200) return indexResp;
    }

    return new Response('Not Found', { status: 404 });
  },

  // Daily cron — run alerts
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await runAlerts(env, 60, false);
          console.log('[cron] alerts result:', JSON.stringify(result));
        } catch (err) {
          console.error('[cron] alerts failed:', err);
        }
      })()
    );
  },
} satisfies ExportedHandler<Env>;