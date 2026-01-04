import { DurableObject } from 'cloudflare:workers';
import { DiscordClient, GatewayIntents, MessageHelper } from 'flarecord';
import type { DurableObjectState, DurableObjectNamespace } from '@cloudflare/workers-types';
import { extractFacebookUrls, fetchFacebookMetadata } from './utils/facebookMetadata';
import { createRichPreviewEmbed } from './utils/discordEmbed';

export interface Env {
  DISCORD_BOT_TOKEN: string;
  DISCORD_BOT: DurableObjectNamespace<DiscordBot>;
  LINK_METADATA_CACHE: KVNamespace;
}

export class DiscordBot extends DurableObject<Env> {
  private client: DiscordClient;
  private messageHelper: MessageHelper | null = null;
  private botToken: string;
  private rateLimitTimestamps: Map<string, number[]> = new Map();
  private readonly RATE_LIMIT_MAX_REQUESTS = 10;
  private readonly RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
  private readonly SUPPRESS_EMBEDS_FLAG = 1 << 2; // 4

  constructor(ctx: DurableObjectState, env: Env) {
    try {
      super(ctx, env);

      if (!env.DISCORD_BOT_TOKEN) {
        console.error('[ERROR] DISCORD_BOT_TOKEN is missing from environment');
        throw new Error('DISCORD_BOT_TOKEN is required');
      }

      this.botToken = env.DISCORD_BOT_TOKEN;

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
          flags?: number;
        };

        // Ignore bot messages
        if (message.author?.bot || !message.channel_id || !this.messageHelper) {
          return;
        }

        // Ensure we have required message fields
        if (!message.id) {
          console.error(`[ERROR] [MESSAGE] Missing message ID in message data`);
          return;
        }

        const messageId = message.id;
        const channelId = message.channel_id;
        const guildId = message.guild_id;

        // Extract Facebook URLs from the message
        const content = message.content || '';
        const facebookUrls = extractFacebookUrls(content);

        if (facebookUrls.length === 0) {
          return;
        }

        console.log(`[INFO] [MESSAGE] Processing ${facebookUrls.length} Facebook URL(s) from message ${messageId} in channel ${channelId}`);

        // Check rate limit
        if (!channelId || this.isRateLimited(channelId)) {
          console.log(`[INFO] [RATE_LIMIT] Rate limit exceeded for channel ${channelId}`);
          return;
        }

        // Suppress native Discord embeds on the original message
        // Small delay reduces "embed flicker" (Discord may render before we suppress)
        try {
          await new Promise(resolve => setTimeout(resolve, 600));
          await this.suppressEmbeds(channelId, messageId, message.flags);
          console.log(`[INFO] [SUPPRESS] Suppressed embeds for message ${messageId}`);
        } catch (suppressError) {
          console.error(`[ERROR] [SUPPRESS] Failed to suppress embeds for message ${messageId}:`, suppressError instanceof Error ? suppressError.message : suppressError);
          // Continue even if suppress fails - we still want to post our embed
        }

        const messageHelper = this.messageHelper; // Store reference to avoid null check issues

        // Process all Facebook URLs in parallel
        const results = await Promise.allSettled(
          facebookUrls.map(async (url) => {
            try {
              console.log(`[INFO] [PROCESS] Fetching metadata for ${url}`);

              // Fetch metadata with cache
              const metadata = await fetchFacebookMetadata(url, env.LINK_METADATA_CACHE);

              if (!metadata) {
                console.error(`[ERROR] [PROCESS] No metadata extracted for ${url}`);
                return;
              }

              if (!metadata.title && !metadata.description) {
                console.error(`[ERROR] [PROCESS] Metadata has no title or description for ${url}`);
                return;
              }

              // Create embed with Facebook-specific color
              const embed = createRichPreviewEmbed(metadata, url, { color: 0x1877f2 });

              // Reply to the original message with embed
              try {
                await messageHelper.reply(channelId, messageId, guildId, {
                  embeds: [embed],
                });
                console.log(`[INFO] [PROCESS] Successfully replied with embed for ${url}`);
              } catch (replyError) {
                console.error(`[ERROR] [REPLY] Failed to reply for ${url}:`, replyError instanceof Error ? replyError.message : replyError);
                if (replyError instanceof Error && replyError.stack) {
                  console.error(`[ERROR] [REPLY] Stack trace:`, replyError.stack);
                }
                throw replyError; // Re-throw to be caught by outer catch
              }
            } catch (error) {
              console.error(`[ERROR] [PROCESS] Error processing Facebook URL ${url} (message ${messageId}, channel ${channelId}):`, error instanceof Error ? error.message : error);
              if (error instanceof Error && error.stack) {
                console.error(`[ERROR] [PROCESS] Stack trace:`, error.stack);
              }
              throw error; // Re-throw to ensure Promise.allSettled captures it
            }
          })
        );

        // Log any rejected promises
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(`[ERROR] [PROCESS] Promise rejected for URL ${facebookUrls[index]}:`, result.reason instanceof Error ? result.reason.message : result.reason);
            if (result.reason instanceof Error && result.reason.stack) {
              console.error(`[ERROR] [PROCESS] Rejected promise stack:`, result.reason.stack);
            }
          }
        });
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
  }

  /**
   * Suppress native Discord embeds on a message by setting the SUPPRESS_EMBEDS flag
   * Requires bot to have "Manage Messages" permission
   */
  private async suppressEmbeds(channelId: string, messageId: string, currentFlags?: number): Promise<void> {
    try {
      // Get current message flags if not provided
      let flags = currentFlags;
      if (typeof flags !== 'number') {
        try {
          const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
          const response = await fetch(url, {
            headers: {
              Authorization: `Bot ${this.botToken}`,
            },
          });

          if (!response.ok) {
            throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
          }

          const messageData = await response.json() as { flags?: number };
          flags = messageData.flags ?? 0;
        } catch (error) {
          console.error(`[ERROR] [SUPPRESS] Failed to fetch message flags:`, error instanceof Error ? error.message : error);
          flags = 0; // Default to 0 if fetch fails
        }
      }

      // Set the SUPPRESS_EMBEDS flag
      const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          flags: flags | this.SUPPRESS_EMBEDS_FLAG,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Discord API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error(`[ERROR] [SUPPRESS] Error suppressing embeds:`, error instanceof Error ? error.message : error);
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
