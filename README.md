# Discord Rich Previews Bot

A Discord bot built on Cloudflare Durable Objects using [flarecord](https://github.com/vaishnav-mk/flarecord) that automatically generates rich previews for Facebook links (posts, profiles, events, pages) similar to Facebook Messenger.

## Features

- 🤖 **Discord bot** using Cloudflare Durable Objects for persistent connections
- 🔗 **Automatic detection** of Facebook links in messages
- 📸 **Rich embeds** with images, thumbnails, titles, and descriptions
- ⚡ **Low latency** powered by Cloudflare Workers
- 🔄 **KV caching** for improved performance and reduced Facebook requests
- 🛡️ **TypeScript** support with full type safety
- 🚦 **Rate limiting** to prevent spam (10 requests per minute per channel)
- ⏱️ **Timeout protection** (10 second timeout on Facebook fetches)

## Prerequisites

- Node.js 18+ and pnpm
- Cloudflare account with Workers, Durable Objects, and KV enabled
- Discord Bot Token ([Create one here](https://discord.com/developers/applications))

## Setup

### 1. Install Dependencies

```bash
npm install -g pnpm
pnpm install
```

### 2. Configure Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or select an existing one
3. Go to the "Bot" section and create a bot
4. Copy the bot token
5. **Enable "Message Content Intent"** in the Bot section (required for reading message content)
6. Invite the bot to your server using this OAuth2 URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=84992&scope=bot%20applications.commands
```

**Required Permissions:**
- View Channels (1024)
- Send Messages (2048)
- Embed Links (16384)
- Read Message History (65536)

**Total:** `84992`

### 3. Set up Cloudflare

1. Install Wrangler CLI: `pnpm add -g wrangler` or `npm install -g wrangler`
2. Login to Cloudflare: `wrangler login`
3. Create KV namespaces:
   ```bash
   # Create production namespace
   wrangler kv namespace create LINK_METADATA_CACHE
   # Create preview namespace (for wrangler dev)
   wrangler kv namespace create LINK_METADATA_CACHE --preview
   ```
4. Update `wrangler.jsonc` with the KV namespace IDs:
   - Copy the `id` from the production namespace output (looks like: `52ca52a99b074d72832e283110822e1d`)
   - Copy the `preview_id` from the preview namespace output
   - Replace `your-production-kv-namespace-id-here` and `your-preview-kv-namespace-id-here` in `wrangler.jsonc`

   **Example:**
   ```jsonc
   "kv_namespaces": [
     {
       "binding": "LINK_METADATA_CACHE",
       "id": "52ca52a99b074d72832e283110822e1d",
       "preview_id": "abc123def456..."
     }
   ]
   ```

### 4. Configure Environment Variables

**Local development** - Create `.dev.vars`:
```env
DISCORD_BOT_TOKEN=your_discord_bot_token_here
```

**Production** - Set secrets using Wrangler:
```bash
wrangler secret put DISCORD_BOT_TOKEN
```

### 5. Deploy

```bash
pnpm run deploy
```

After deployment, your Worker URL will be something like:
`https://discord-rich-previews.your-subdomain.workers.dev`

### 6. Verify Bot Connection

The bot connects automatically via Discord Gateway (WebSocket). No URL configuration needed in Discord settings.

To verify the bot is running:
```bash
curl https://your-worker-url.workers.dev/health
```

## How It Works

1. The bot connects to Discord Gateway using flarecord
2. It listens for messages in all channels where it has access
3. When a message contains a Facebook URL, it:
   - Checks KV cache for existing metadata
   - Fetches the page HTML (with browser-like headers)
   - Extracts Open Graph metadata (title, description, image, thumbnail)
   - Creates a Discord embed with the metadata
   - Caches the result in KV for 1 hour
   - Sends the embed as a reply

## Supported Facebook URLs

The bot detects and processes:
- Facebook posts: `https://www.facebook.com/username/posts/...`
- Facebook profiles: `https://www.facebook.com/username`
- Facebook pages: `https://www.facebook.com/pagename`
- Facebook events: `https://www.facebook.com/events/...`
- Mobile Facebook URLs: `https://m.facebook.com/...`
- Facebook share URLs: `https://www.facebook.com/share/...`

## Features

### Thumbnail Support
When a profile picture is detected in the page metadata, it's shown as a thumbnail next to the embed title.

### Caching
Metadata is cached in Cloudflare KV for 1 hour to reduce Facebook API requests and improve response times.

### Rate Limiting
The bot limits processing to 10 requests per minute per channel to prevent spam.

### Error Handling
- Automatic mobile fallback if desktop version fails
- Timeout protection (10 seconds)
- Graceful error handling with error logging

## Local Development

Run the bot locally:

```bash
pnpm run dev
```

Test Facebook URL extraction:

```bash
pnpm run test:facebook https://www.facebook.com/example/post/123
```

## Project Structure

```
discord-rich-previews/
├── src/
│   ├── bot.ts              # Main Durable Object bot class
│   ├── index.ts            # Worker entry point
│   └── utils/
│       ├── facebookMetadata.ts  # Facebook URL detection and metadata fetching
│       └── discordEmbed.ts      # Discord embed creation
├── scripts/
│   └── test-facebook-url.ts    # Test script for Facebook URL extraction
├── package.json
├── tsconfig.json
├── wrangler.jsonc          # Cloudflare Workers configuration
└── README.md
```

## Configuration

### Rate Limiting

Adjust rate limits in `src/bot.ts`:
```typescript
private readonly RATE_LIMIT_MAX_REQUESTS = 10; // requests per window
private readonly RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
```

### Cache TTL

Adjust cache duration in `src/utils/facebookMetadata.ts`:
```typescript
expirationTtl: 3600, // 1 hour in seconds
```

### Fetch Timeout

Adjust timeout in `src/utils/facebookMetadata.ts`:
```typescript
10000 // 10 seconds
```

## Limitations

- Facebook may rate limit or block requests if too many are made
- Some Facebook content may require authentication to view
- Private posts/pages won't be accessible
- Facebook's HTML structure may change, affecting metadata extraction
- Native Discord link previews cannot be suppressed by bots (only message authors can do this)

## Troubleshooting

### Bot not connecting
- Verify `DISCORD_BOT_TOKEN` is set correctly: `wrangler secret list`
- Check that "Message Content Intent" is enabled in Discord Developer Portal
- Check Cloudflare dashboard logs for errors

### No previews appearing
- Ensure bot has "View Channels" and "Read Message History" permissions
- Check that the bot is in the channel
- Verify Facebook URLs are publicly accessible
- Check Cloudflare dashboard logs for fetch errors

### High latency
- Check KV cache is working (should see cache hits in logs)
- Verify Cloudflare Worker is deployed in a region close to your users

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
