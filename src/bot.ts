import { DurableObject } from 'cloudflare:workers';
import { DiscordClient, GatewayIntents, MessageHelper } from 'flarecord';
import type { DurableObjectState, DurableObjectNamespace } from '@cloudflare/workers-types';
import { extractFacebookUrls, fetchFacebookMetadata } from './utils/facebookMetadata';
import { createFacebookEmbed } from './utils/discordEmbed';

export interface Env {
  DISCORD_BOT_TOKEN: string;
  DISCORD_BOT: DurableObjectNamespace<DiscordBot>;
  LINK_METADATA_CACHE: KVNamespace;
}

export class DiscordBot extends DurableObject<Env> {
  private client: DiscordClient;
  private messageHelper: MessageHelper | null = null;
  private rateLimitTimestamps: Map<string, number[]> = new Map();
  private readonly RATE_LIMIT_MAX_REQUESTS = 10;
  private readonly RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

  constructor(ctx: DurableObjectState, env: Env) {
    try {
      super(ctx, env);

      if (!env.DISCORD_BOT_TOKEN) {
        console.error('[ERROR] DISCORD_BOT_TOKEN is missing from environment');
        throw new Error('DISCORD_BOT_TOKEN is required');
      }

    try {

      this.client = new DiscordClient(ctx, {
      token: env.DISCORD_BOT_TOKEN,
      intents:
        GatewayIntents.GUILDS |
        GatewayIntents.GUILD_MESSAGES |
        GatewayIntents.MESSAGE_CONTENT,
      onReady: (data: any) => {
        console.log(`[READY] Bot ready: ${data.user?.username || 'unknown'} (ID: ${data.user?.id || 'unknown'})`);
        this.messageHelper = new MessageHelper(env.DISCORD_BOT_TOKEN);
      },
      onMessage: async (data: any) => {
        if (data._gatewayMetadata?.event !== 'MESSAGE_CREATE') {
          return;
        }

        const message = data as {
          id?: string;
          author?: { bot?: boolean; id?: string; username?: string };
          content?: string;
          channel_id?: string;
          guild_id?: string;
        };

        // Ignore bot messages
        if (message.author?.bot || !message.channel_id || !this.messageHelper) {
          return;
        }

        // Extract Facebook URLs from the message
        const content = message.content || '';
        const facebookUrls = extractFacebookUrls(content);

        if (facebookUrls.length === 0) {
          return;
        }

        // Check rate limit
        const channelId = message.channel_id;
        if (!channelId || this.isRateLimited(channelId)) {
          return;
        }

        const messageHelper = this.messageHelper; // Store reference to avoid null check issues

        // Process all Facebook URLs in parallel
        await Promise.allSettled(
          facebookUrls.map(async (url) => {
            try {
              // Fetch metadata with cache
              const metadata = await fetchFacebookMetadata(url, env.LINK_METADATA_CACHE);

              if (metadata && (metadata.title || metadata.description)) {
                // Create embed
                const embed = createFacebookEmbed(metadata, url);

                // Send embed
                await messageHelper.send(channelId, {
                  embeds: [embed],
                });
              }
            } catch (error) {
              console.error(`[ERROR] Error processing Facebook URL ${url}:`, error instanceof Error ? error.message : error);
              if (error instanceof Error && error.stack) {
                console.error(`[ERROR] Stack trace:`, error.stack);
              }
            }
          })
        );
      },
      onDispatch: (event: string, data: any) => {
        // Dispatch events are handled by onReady/onMessage callbacks
      },
      onError: (error: any) => {
        console.error(`[GATEWAY_ERROR] Discord Gateway error:`, error instanceof Error ? error.message : String(error));
        if (error instanceof Error && error.stack) {
          console.error(`[GATEWAY_ERROR] Stack:`, error.stack);
        }
      },
    });
    } catch (error) {
      console.error('[ERROR] Failed to initialize DiscordClient:', error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack) {
        console.error('[ERROR] Stack:', error.stack);
      }
      throw error;
    }
    } catch (error) {
      console.error('[ERROR] Constructor error:', error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack) {
        console.error('[ERROR] Stack:', error.stack);
      }
      throw error;
    }
  }

  /**
   * Check if rate limit is exceeded for a channel
   */
  private isRateLimited(channelId: string): boolean {
    const now = Date.now();
    const timestamps = this.rateLimitTimestamps.get(channelId) || [];

    // Remove timestamps outside the window
    const recentTimestamps = timestamps.filter(ts => now - ts < this.RATE_LIMIT_WINDOW_MS);

    if (recentTimestamps.length >= this.RATE_LIMIT_MAX_REQUESTS) {
      return true;
    }

    // Add current timestamp
    recentTimestamps.push(now);
    this.rateLimitTimestamps.set(channelId, recentTimestamps);

    return false;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (!this.client) {
      console.error(`[ERROR] DiscordClient not initialized`);
      return new Response(JSON.stringify({ error: 'DiscordClient not initialized' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle internal init requests (from health check)
    if (url.hostname === 'internal' && url.pathname === '/init') {
      // IMPORTANT: Call client.fetch() to trigger Gateway connection initialization
      // Flarecord's client.fetch() initializes the connection on first call
      try {
        const initRequest = new Request('https://discord.com/api', { method: 'GET' });
        await this.client.fetch(initRequest);
      } catch (err) {
        console.error(`[ERROR] Error initializing Gateway connection:`, err instanceof Error ? err.message : err);
      }

      return new Response(JSON.stringify({ status: 'initialized' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle manual alarm trigger for testing
    if (url.hostname === 'internal' && url.pathname === '/trigger-alarm') {
      try {
        await this.alarm();
        return new Response(JSON.stringify({ status: 'alarm_triggered' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          status: 'error',
          error: err instanceof Error ? err.message : String(err)
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    try {
      const response = await this.client.fetch(request);
      return response;
    } catch (error) {
      console.error(`[ERROR] Error in DiscordClient.fetch:`, error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack) {
        console.error(`[ERROR] Stack:`, error.stack);
      }
      throw error;
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.client.alarm();
    } catch (error) {
      console.error(`[ERROR] Error in alarm:`, error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack) {
        console.error(`[ERROR] Stack:`, error.stack);
      }
      throw error;
    }
  }
}
