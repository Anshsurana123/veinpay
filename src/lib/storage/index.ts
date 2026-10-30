/**
 * VeinPay — Storage Layer Factory & Manager
 * File: src/lib/storage/index.ts
 */

import type { KeyValueStore } from './types';
import { InMemoryKeyValueStore } from './memory';
import { UpstashRedisStore } from './upstash';

export * from './types';
export * from './memory';
export * from './upstash';

let activeStore: KeyValueStore | null = null;

export function assertStorageConfigured(): void {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const allowEphemeral = process.env.ALLOW_EPHEMERAL_STATE === 'true';

  if (process.env.NODE_ENV === 'production' && (!url || !token) && !allowEphemeral) {
    throw new Error(
      'FATAL: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production unless ALLOW_EPHEMERAL_STATE=true.'
    );
  }
}

export function getStorage(): KeyValueStore {
  if (activeStore) return activeStore;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const allowEphemeral = process.env.ALLOW_EPHEMERAL_STATE === 'true';

  if (url && token) {
    activeStore = new UpstashRedisStore(url, token);
    return activeStore;
  }

  if (process.env.NODE_ENV === 'production' && !allowEphemeral) {
    throw new Error(
      'FATAL: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production.'
    );
  }

  activeStore = new InMemoryKeyValueStore();
  return activeStore;
}

export function setStorageForTesting(store: KeyValueStore | null): void {
  activeStore = store;
}
