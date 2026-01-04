import type { FacebookMetadata } from './facebookMetadata';

/**
 * Creates a Discord embed from Facebook metadata
 */
export function createFacebookEmbed(metadata: FacebookMetadata, originalUrl: string): any {
  const embed: any = {
    type: 'rich',
    color: 0x1877f2, // Facebook blue
    url: metadata.url || originalUrl,
  };

  if (metadata.title) {
    embed.title = metadata.title;
  }

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

  // Add footer with site name if available
  if (metadata.siteName) {
    embed.footer = {
      text: metadata.siteName,
    };
  }

  // Add timestamp
  embed.timestamp = new Date().toISOString();

  return embed;
}
