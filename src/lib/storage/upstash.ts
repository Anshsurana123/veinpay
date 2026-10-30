/**
 * VeinPay — Upstash Redis REST KeyValueStore Implementation
 * File: src/lib/storage/upstash.ts
 */

import type { KeyValueStore, StorageOptions } from './types';

export class UpstashRedisStore implements KeyValueStore {
  readonly isPersistent = true;
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
  }

  private async executeCommand<T>(command: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upstash Redis command failed HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as { result?: T; error?: string };
    if (data.error) {
      throw new Error(`Upstash Redis error: ${data.error}`);
    }
    return data.result as T;
  }

  async get<T>(key: string): Promise<T | null> {
    const res = await this.executeCommand<string | null>(['GET', key]);
    if (res === null || res === undefined) return null;
    try {
      return JSON.parse(res) as T;
    } catch {
      return res as unknown as T;
    }
  }

  async set<T>(key: string, value: T, options?: StorageOptions): Promise<boolean> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const cmd: (string | number)[] = ['SET', key, serialized];
    if (options?.exSeconds) {
      cmd.push('EX', options.exSeconds);
    }
    if (options?.nx) {
      cmd.push('NX');
    }
    const res = await this.executeCommand<string | null>(cmd);
    return res === 'OK';
  }

  async del(key: string): Promise<boolean> {
    const res = await this.executeCommand<number>(['DEL', key]);
    return res > 0;
  }

  async getdel<T>(key: string): Promise<T | null> {
    const res = await this.executeCommand<string | null>(['GETDEL', key]);
    if (res === null || res === undefined) return null;
    try {
      return JSON.parse(res) as T;
    } catch {
      return res as unknown as T;
    }
  }

  async incr(key: string): Promise<number> {
    return this.executeCommand<number>(['INCR', key]);
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const res = await this.executeCommand<number>(['EXPIRE', key, seconds]);
    return res === 1;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.executeCommand<number>(['ZADD', key, score, member]);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.executeCommand<string[]>(['ZREVRANGE', key, start, stop]);
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    return this.executeCommand<number>(['ZREMRANGEBYRANK', key, start, stop]);
  }

  async mget<T>(keys: string[]): Promise<Array<T | null>> {
    if (keys.length === 0) return [];
    const raw = await this.executeCommand<Array<string | null>>(['MGET', ...keys]);
    return (raw || []).map((item) => {
      if (item === null || item === undefined) return null;
      try {
        return JSON.parse(item) as T;
      } catch {
        return item as unknown as T;
      }
    });
  }

  async eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T> {
    const cmd: (string | number)[] = ['EVAL', script, keys.length, ...keys, ...args];
    return this.executeCommand<T>(cmd);
  }

  async clear(): Promise<void> {
    await this.executeCommand(['FLUSHDB']);
  }
}
