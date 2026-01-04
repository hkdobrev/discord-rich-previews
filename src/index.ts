import { DiscordBot } from './bot';
import type { Env } from './bot';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Verify DO binding exists
    if (!env.DISCORD_BOT) {
      console.error(`[ERROR] DISCORD_BOT binding is missing`);
      return new Response(JSON.stringify({ error: 'DISCORD_BOT binding missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle health check endpoint
    if (url.pathname === '/health' || (url.pathname === '/' && request.method === 'GET')) {
      // Ensure Durable Object is initialized by making a request to it
      const id = env.DISCORD_BOT.idFromName('main-v2');
      const stub = env.DISCORD_BOT.get(id);
      const initRequest = new Request('https://internal/init', { method: 'GET' });

      try {
        await stub.fetch(initRequest);
        return new Response(JSON.stringify({
          status: 'ok',
          service: 'discord-rich-previews',
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error(`[ERROR] Durable Object init error:`, err instanceof Error ? err.message : err);
        return new Response(JSON.stringify({
          status: 'ok',
          service: 'discord-rich-previews',
          error: err instanceof Error ? err.message : String(err)
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Forward all requests to Durable Object
    // Flarecord manages Gateway connections internally and uses the Durable Object's fetch method
    const id = env.DISCORD_BOT.idFromName('main-v2');
    const stub = env.DISCORD_BOT.get(id);

    try {
      const response = await stub.fetch(request);
      return response;
    } catch (error) {
      console.error(`[ERROR] Error forwarding to Durable Object:`, error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack) {
        console.error(`[ERROR] Stack:`, error.stack);
      }
      throw error;
    }
  },
};

export { DiscordBot };
