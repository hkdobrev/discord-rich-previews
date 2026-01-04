#!/usr/bin/env node

/**
 * Test script for Facebook URL metadata extraction
 * Usage: pnpm test:facebook <facebook-url>
 * Example: pnpm test:facebook https://www.facebook.com/example/posts/123
 */

import { fetchFacebookMetadata } from '../src/utils/facebookMetadata';

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error('❌ Error: Please provide a Facebook URL');
    console.log('\nUsage:');
    console.log('  pnpm tsx scripts/test-facebook-url.ts <facebook-url>');
    console.log('\nExample:');
    console.log('  pnpm tsx scripts/test-facebook-url.ts https://www.facebook.com/example/posts/123');
    process.exit(1);
  }

  console.log('🔍 Fetching metadata for:', url);
  console.log('─'.repeat(60));

  try {
    const metadata = await fetchFacebookMetadata(url);

    if (!metadata) {
      console.log('❌ No metadata found or failed to fetch');
      process.exit(1);
    }

    console.log('\n✅ Metadata extracted successfully!\n');
    console.log('─'.repeat(60));

    if (metadata.title) {
      console.log('📌 Title:');
      console.log(`   ${metadata.title}`);
      console.log();
    }

    if (metadata.description) {
      console.log('📝 Description:');
      const desc = metadata.description.length > 200
        ? metadata.description.substring(0, 200) + '...'
        : metadata.description;
      console.log(`   ${desc}`);
      console.log();
    }

    if (metadata.image) {
      console.log('🖼️  Image URL:');
      console.log(`   ${metadata.image}`);
      console.log();
    }

    if (metadata.url) {
      console.log('🔗 URL:');
      console.log(`   ${metadata.url}`);
      console.log();
    }

    if (metadata.siteName) {
      console.log('🏷️  Site Name:');
      console.log(`   ${metadata.siteName}`);
      console.log();
    }

    if (metadata.type) {
      console.log('📋 Type:');
      console.log(`   ${metadata.type}`);
      console.log();
    }

    console.log('─'.repeat(60));
    console.log('\n📊 Raw JSON:');
    console.log(JSON.stringify(metadata, null, 2));

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
