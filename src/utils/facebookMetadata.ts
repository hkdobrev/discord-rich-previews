/**
 * Fetches Open Graph metadata from Facebook URLs
 */
export interface FacebookMetadata {
  title?: string;
  description?: string;
  image?: string;
  thumbnail?: string; // Profile picture thumbnail (shown next to title)
  url?: string;
  siteName?: string;
  type?: string;
}

/**
 * Extracts metadata from HTML content
 */
function extractMetadataFromHtml(html: string, url: string): FacebookMetadata | null {
  const metadata: FacebookMetadata = {};

  // Extract og:title
  const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (titleMatch) {
    metadata.title = cleanEscapeSequences(decodeHtmlEntities(titleMatch[1]));
  }

  // Extract og:description
  const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  if (descMatch) {
    metadata.description = cleanEscapeSequences(decodeHtmlEntities(descMatch[1]));
  }

  // Extract og:image (decode HTML entities so image hash works correctly)
  const imageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (imageMatch) {
    metadata.image = decodeHtmlEntities(imageMatch[1]);
  }

  // Try to extract profile picture from JSON data in the page (for thumbnail)
  // Look for pattern: ,"actors":[{"profile_picture":{"uri":"https://...
  // Handle both escaped and unescaped JSON formats
  const profilePicPatterns = [
    /,"actors":\[\{"profile_picture":\{"uri":"([^"]+)"\}/,
    /"actors":\[\{"profile_picture":\{"uri":"([^"]+)"\}/,
    /"profile_picture":\{"uri":"([^"]+)"\}/,
  ];

  for (const pattern of profilePicPatterns) {
    const profilePicMatch = html.match(pattern);
    if (profilePicMatch && profilePicMatch[1]) {
      // Decode escaped slashes and Unicode escapes
      const profilePic = profilePicMatch[1]
        .replace(/\\\//g, '/') // Unescape forward slashes (\/ -> /)
        .replace(/\\u([0-9a-fA-F]{4})/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))); // Decode Unicode escapes

      // Use as thumbnail (shown next to title)
      metadata.thumbnail = profilePic;

      // If no og:image was found, also use profile pic as main image
      if (!metadata.image) {
        metadata.image = profilePic;
      }
      break;
    }
  }

  // Extract og:url (decode HTML entities)
  const urlMatch = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i);
  if (urlMatch) {
    metadata.url = decodeHtmlEntities(urlMatch[1]);
  }

  // Extract og:site_name
  const siteNameMatch = html.match(/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i);
  if (siteNameMatch) {
    metadata.siteName = decodeHtmlEntities(siteNameMatch[1]);
  }

  // Extract og:type
  const typeMatch = html.match(/<meta\s+property=["']og:type["']\s+content=["']([^"']+)["']/i);
  if (typeMatch) {
    metadata.type = typeMatch[1];
  }

  // Fallback to regular title tag if og:title not found
  if (!metadata.title) {
    const regularTitleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (regularTitleMatch) {
      metadata.title = cleanEscapeSequences(decodeHtmlEntities(regularTitleMatch[1]));
    }
  }

  // If we have at least a title or description, return the metadata
  if (metadata.title || metadata.description) {
    metadata.url = metadata.url || url;
    return metadata;
  }

  return null;
}

/**
 * Cache key for link metadata in KV (generic, works for any provider)
 */
function getCacheKey(url: string): string {
  // Use URL as cache key (KV handles key length limits)
  // Generic format that works for Facebook and future providers
  return `link_meta:${url}`;
}

/**
 * Fetches Facebook metadata with timeout
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Extracts Facebook metadata from HTML using Open Graph tags
 */
export async function fetchFacebookMetadata(
  url: string,
  cache?: KVNamespace
): Promise<FacebookMetadata | null> {
  try {
    // Check cache first
    if (cache) {
      const cacheKey = getCacheKey(url);
      try {
        const cached = await cache.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as FacebookMetadata;
        }
      } catch (cacheError) {
        console.error(`[ERROR] Cache read error:`, cacheError instanceof Error ? cacheError.message : cacheError);
        // Continue with fetch if cache read fails
      }
    }

    // Normalize Facebook share URLs - they often redirect to the actual post
    let normalizedUrl = url;

    // Handle Facebook share URLs (facebook.com/share/... or m.facebook.com/share/...)
    // These URLs redirect to the actual post, so we'll follow redirects
    if (url.includes('/share/')) {
      // Ensure we're using the www version for better metadata extraction
      normalizedUrl = url.replace(/^(https?:\/\/)(m\.|www\.)?(facebook\.com)/, '$1www.$3');
    }

    // Fetch the HTML content with browser-like headers to avoid detection (with timeout)
    const response = await fetchWithTimeout(
      normalizedUrl,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
          'Referer': 'https://www.facebook.com/',
        },
        redirect: 'follow', // Explicitly follow redirects
      },
      10000 // 10 second timeout
    );

    if (!response.ok) {
      // If we get blocked, try the mobile version
      if (response.status === 400 || response.status === 403 || response.status === 401) {
        const mobileUrl = normalizedUrl.replace(/www\.facebook\.com/, 'm.facebook.com');
        try {
          const mobileResponse = await fetchWithTimeout(
            mobileUrl,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
              },
              redirect: 'follow',
            },
            10000 // 10 second timeout
          );

          if (mobileResponse.ok) {
            const html = await mobileResponse.text();
            const metadata = extractMetadataFromHtml(html, mobileUrl);
            if (metadata) {
              return metadata;
            }
          }
        } catch (mobileError) {
          console.error(`[ERROR] Mobile fallback failed:`, mobileError instanceof Error ? mobileError.message : mobileError);
        }
      }

      return null;
    }

    const html = await response.text();
    const metadata = extractMetadataFromHtml(html, normalizedUrl);

    // Store in cache if available
    if (metadata && cache) {
      const cacheKey = getCacheKey(url);
      try {
        await cache.put(cacheKey, JSON.stringify(metadata), {
          expirationTtl: 3600, // 1 hour TTL
        });
      } catch (cacheError) {
        console.error(`[ERROR] Cache write error:`, cacheError instanceof Error ? cacheError.message : cacheError);
        // Continue even if cache write fails
      }
    }

    return metadata;
  } catch (error) {
    console.error(`[FETCH] Error fetching metadata for ${url}:`, error instanceof Error ? error.message : error, error instanceof Error ? error.stack : '');
    return null;
  }
}

/**
 * Cleans escape sequences from text (e.g., \n, \t, \r)
 */
function cleanEscapeSequences(text: string): string {
  return text
    .replace(/\\n/g, ' ') // Replace \n with space
    .replace(/\\t/g, ' ') // Replace \t with space
    .replace(/\\r/g, '') // Remove \r
    .replace(/\\"/g, '"') // Unescape quotes
    .replace(/\\'/g, "'") // Unescape single quotes
    .replace(/\\\\/g, '\\') // Unescape backslashes
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim(); // Remove leading/trailing whitespace
}

/**
 * Decodes HTML entities (including numeric entities and emojis)
 * Important for URLs and image URLs to work correctly (e.g., &amp; -> &)
 * Uses String.fromCodePoint() to properly handle emojis (code points > 0xFFFF)
 */
function decodeHtmlEntities(text: string): string {
  return text
    // Named entities (must come before numeric to avoid double-decoding)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Numeric entities (hexadecimal) - handle emojis first
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => {
      const codePoint = parseInt(hex, 16);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        // Fallback for invalid code points
        return String.fromCharCode(codePoint > 0xFFFF ? 0xFFFD : codePoint);
      }
    })
    // Numeric entities (decimal) - handle emojis
    .replace(/&#(\d+);/g, (_, dec) => {
      const codePoint = parseInt(dec, 10);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        // Fallback for invalid code points
        return String.fromCharCode(codePoint > 0xFFFF ? 0xFFFD : codePoint);
      }
    });
}

/**
 * Checks if a URL is a Facebook URL
 */
export function isFacebookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === 'facebook.com' ||
      hostname === 'www.facebook.com' ||
      hostname === 'm.facebook.com' ||
      hostname === 'fb.com' ||
      hostname === 'www.fb.com' ||
      hostname.endsWith('.facebook.com')
    );
  } catch {
    return false;
  }
}

/**
 * Extracts all Facebook URLs from a text string
 */
export function extractFacebookUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const urls = text.match(urlRegex) || [];
  return urls.filter(url => isFacebookUrl(url));
}
