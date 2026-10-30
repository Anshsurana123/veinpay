/**
 * VeinPay — Unified Storage Layer Types
 * File: src/lib/storage/types.ts
 */

export interface StorageOptions {
  exSeconds?: number;
  nx?: boolean;
}

export interface KeyValueStore {
  readonly isPersistent: boolean;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: StorageOptions): Promise<boolean>;
  del(key: string): Promise<boolean>;
  getdel<T>(key: string): Promise<T | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>;
  mget<T>(keys: string[]): Promise<Array<T | null>>;
  eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T>;
  clear(): Promise<void>;
}
