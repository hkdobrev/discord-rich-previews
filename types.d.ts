/// <reference types="@cloudflare/workers-types" />

// Ensure Workers runtime globals are available even when the package
// isn't auto-resolved by the editor.
declare global {
  const fetch: typeof globalThis.fetch;
  const console: typeof globalThis.console;
  const URL: typeof globalThis.URL;
  type Request = globalThis.Request;
  type Response = globalThis.Response;
}

// Minimal fallback declarations when @cloudflare/workers-types
// is not installed locally.
declare module '@cloudflare/workers-types' {
  export interface DurableObjectState {
    id: DurableObjectId;
  }

  export interface DurableObjectId {
    toString(): string;
  }

  export interface DurableObjectNamespace<DO = any> {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub<DO>;
  }

  export interface DurableObjectStub<DO = any> {
    fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
  }
}

// Module declarations for packages without types

declare module 'cloudflare:workers' {
  import type { DurableObjectState } from '@cloudflare/workers-types';

  export class DurableObject<TEnv = any> {
    constructor(ctx: DurableObjectState, env: TEnv);
    fetch(request: Request): Promise<Response>;
    alarm?(): Promise<void>;
  }
}

declare module 'flarecord' {
  import type { DurableObjectState } from '@cloudflare/workers-types';

  export enum GatewayIntents {
    GUILDS = 1 << 0,
    GUILD_MEMBERS = 1 << 1,
    GUILD_MODERATION = 1 << 2,
    GUILD_EMOJIS_AND_STICKERS = 1 << 3,
    GUILD_INTEGRATIONS = 1 << 4,
    GUILD_WEBHOOKS = 1 << 5,
    GUILD_INVITES = 1 << 6,
    GUILD_VOICE_STATES = 1 << 7,
    GUILD_PRESENCES = 1 << 8,
    GUILD_MESSAGES = 1 << 9,
    GUILD_MESSAGE_REACTIONS = 1 << 10,
    GUILD_MESSAGE_TYPING = 1 << 11,
    DIRECT_MESSAGES = 1 << 12,
    DIRECT_MESSAGE_REACTIONS = 1 << 13,
    DIRECT_MESSAGE_TYPING = 1 << 14,
    MESSAGE_CONTENT = 1 << 15,
    GUILD_SCHEDULED_EVENTS = 1 << 16,
    AUTO_MODERATION_CONFIGURATION = 1 << 17,
    AUTO_MODERATION_EXECUTION = 1 << 18,
    GUILD_MESSAGE_POLLS = 1 << 19,
    DIRECT_MESSAGE_POLLS = 1 << 20,
  }

  export interface DiscordClientConfig {
    token: string;
    intents: number;
    storageKey?: string;
    onReady?: (data: any) => void;
    onMessage?: (data: any) => void | Promise<void>;
    onError?: (error: any) => void;
    onDispatch?: (event: string, data: any) => void;
  }

  export class DiscordClient {
    constructor(ctx: DurableObjectState, config: DiscordClientConfig);
    fetch(request: Request): Promise<Response>;
    alarm(): Promise<void>;
  }

  export class MessageHelper {
    constructor(token: string);
    send(channelId: string, content: string | object): Promise<any>;
    reply(channelId: string, messageId: string, guildId: string | undefined, content: string | object): Promise<any>;
  }
}
