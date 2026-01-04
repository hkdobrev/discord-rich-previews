import type { LinkMetadata } from './facebookMetadata';

/**
 * Provider-specific configuration for embeds
 */
export interface ProviderConfig {
  color?: number;
}

/**
 * Creates a Discord embed from link metadata (generic, works for any provider)
 */
export function createRichPreviewEmbed(
  metadata: LinkMetadata,
  originalUrl: string,
  providerConfig?: ProviderConfig
): any {
  const embed: any = {
    type: 'rich',
    color: providerConfig?.color ?? 0x1877f2, // Default to Facebook blue if not specified
  };

  // Extract domain from article URL for footer
  let articleDomain: string | undefined;
  if (metadata.articleUrl) {
    try {
      const url = new URL(metadata.articleUrl);
      articleDomain = url.hostname.replace(/^www\./, ''); // Remove www. prefix
    } catch {
      // Invalid URL, skip
    }
  }

  // When there's an article URL, use article title as embed title and link to article
  if (metadata.articleUrl && metadata.articleTitle) {
    embed.title = metadata.articleTitle;
    embed.url = metadata.articleUrl; // Title links to article URL
  } else {
    // Otherwise, use regular title and link to Facebook post
    if (metadata.title) {
      embed.title = metadata.title;
    }
    embed.url = metadata.url || originalUrl; // Title links to Facebook post
  }

  // Description is always from the FB post
  if (metadata.description) {
    embed.description = metadata.description;
    // Discord has a limit of 4096 characters for description
    if (embed.description.length > 4096) {
      embed.description = embed.description.substring(0, 4093) + '...';
    }
  }

  // Add thumbnail (profile picture) next to title if available
  if (metadata.thumbnail) {
    embed.thumbnail = {
      url: metadata.thumbnail,
    };
  }

  // Add main image if available (only if different from thumbnail)
  if (metadata.image && metadata.image !== metadata.thumbnail) {
    embed.image = {
      url: metadata.image,
    };
  } else if (metadata.image && !metadata.thumbnail) {
    // If we only have image and no thumbnail, use it as main image
    embed.image = {
      url: metadata.image,
    };
  }

  // Footer: show domain when there's an article URL, otherwise show site name
  // Footer cannot be linked or bolded in Discord
  if (metadata.articleUrl && articleDomain) {
    // Discord footer has a limit of 2048 characters
    let footerText = articleDomain;
    if (footerText.length > 2048) {
      footerText = footerText.substring(0, 2045) + '...';
    }
    embed.footer = {
      text: footerText,
    };
  } else if (metadata.siteName) {
    embed.footer = {
      text: metadata.siteName,
    };
  }

  // Add timestamp
  embed.timestamp = new Date().toISOString();

  return embed;
}
