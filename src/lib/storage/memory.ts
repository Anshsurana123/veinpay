/**
 * VeilPay — In-Memory KeyValueStore Implementation (Dev & Test Fallback)
 * File: src/lib/storage/memory.ts
 */

import type { KeyValueStore, StorageOptions } from './types';

interface MemoryEntry {
  value: unknown;
  expiresAt?: number;
}

interface ZSetEntry {
  member: string;
  score: number;
}

export class InMemoryKeyValueStore implements KeyValueStore {
  readonly isPersistent = false;
  private store = new Map<string, MemoryEntry>();
  private zsets = new Map<string, Map<string, number>>();

  private isExpired(entry: MemoryEntry | undefined): boolean {
    if (!entry) return true;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      return true;
    }
    return false;
  }

  private cleanKeyIfExpired(key: string): void {
    const entry = this.store.get(key);
    if (entry && this.isExpired(entry)) {
      this.store.delete(key);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    this.cleanKeyIfExpired(key);
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      return null;
    }
    return JSON.parse(JSON.stringify(entry.value)) as T;
  }

  async set<T>(key: string, value: T, options?: StorageOptions): Promise<boolean> {
    this.cleanKeyIfExpired(key);
    const exists = this.store.has(key);

    if (options?.nx && exists) {
      return false;
    }

    const expiresAt = options?.exSeconds
      ? Date.now() + options.exSeconds * 1000
      : undefined;

    this.store.set(key, {
      value: JSON.parse(JSON.stringify(value)),
      expiresAt,
    });
    return true;
  }

  async del(key: string): Promise<boolean> {
    this.zsets.delete(key);
    return this.store.delete(key);
  }

  async getdel<T>(key: string): Promise<T | null> {
    this.cleanKeyIfExpired(key);
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    this.store.delete(key);
    return JSON.parse(JSON.stringify(entry.value)) as T;
  }

  async incr(key: string): Promise<number> {
    this.cleanKeyIfExpired(key);
    const entry = this.store.get(key);
    let val = 1;
    let expiresAt: number | undefined;

    if (entry && !this.isExpired(entry)) {
      const num = Number(entry.value);
      val = (Number.isNaN(num) ? 0 : num) + 1;
      expiresAt = entry.expiresAt;
    }

    this.store.set(key, { value: val, expiresAt });
    return val;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    this.cleanKeyIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + seconds * 1000;
    this.store.set(key, entry);
    return true;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    let zset = this.zsets.get(key);
    if (!zset) {
      zset = new Map<string, number>();
      this.zsets.set(key, zset);
    }
    const isNew = !zset.has(member);
    zset.set(member, score);
    return isNew ? 1 : 0;
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const zset = this.zsets.get(key);
    if (!zset) return [];
    const entries: ZSetEntry[] = [];
    for (const [member, score] of zset.entries()) {
      entries.push({ member, score });
    }
    // Sort descending by score
    entries.sort((a, b) => b.score - a.score);

    const actualStop = stop < 0 ? entries.length + stop + 1 : stop + 1;
    return entries.slice(start, actualStop).map((e) => e.member);
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    const zset = this.zsets.get(key);
    if (!zset) return 0;
    const entries: ZSetEntry[] = [];
    for (const [member, score] of zset.entries()) {
      entries.push({ member, score });
    }
    // In Redis ZREMRANGEBYRANK, rank 0 is the lowest score (ascending)
    entries.sort((a, b) => a.score - b.score);

    const actualStop = stop < 0 ? entries.length + stop + 1 : stop + 1;
    const toRemove = entries.slice(start, actualStop);
    for (const entry of toRemove) {
      zset.delete(entry.member);
    }
    return toRemove.length;
  }

  async mget<T>(keys: string[]): Promise<Array<T | null>> {
    const results: Array<T | null> = [];
    for (const key of keys) {
      results.push(await this.get<T>(key));
    }
    return results;
  }

  async eval<T>(_script: string, _keys: string[], _args: (string | number)[]): Promise<T> {
    // For test fallback: if script is the sliding window rate limiter, simulate it
    throw new Error('Lua eval is only supported on Upstash Redis; use native KeyValueStore methods in memory mode.');
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.zsets.clear();
  }
}
