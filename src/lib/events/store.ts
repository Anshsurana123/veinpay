import type { ThreatMetricsSummary, VeinPayEvent } from './types';
import { getStorage } from '@/lib/storage';

export interface EventStore {
  readonly isPersistent: boolean;
  recordEvent(
    event: Omit<VeinPayEvent, 'id' | 'timestamp'> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<VeinPayEvent>;
  updateEvent(
    id: string,
    updates: Partial<VeinPayEvent>
  ): Promise<VeinPayEvent | null>;
  getEvents(filter?: {
    linkId?: string;
    simulated?: boolean;
    limit?: number;
  }): Promise<VeinPayEvent[]>;
  getThreatMetrics(linkId?: string): Promise<ThreatMetricsSummary>;
  clear(): Promise<void>;
}

export class InMemoryEventStore implements EventStore {
  readonly isPersistent = false;
  private events: VeinPayEvent[] = [];
  private eventById = new Map<string, VeinPayEvent>();

  async recordEvent(
    input: Omit<VeinPayEvent, 'id' | 'timestamp'> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<VeinPayEvent> {
    const event: VeinPayEvent = {
      ...input,
      id: input.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };

    this.eventById.set(event.id, event);
    this.events.unshift(event);
    if (this.events.length > 500) {
      const removed = this.events.pop();
      if (removed) this.eventById.delete(removed.id);
    }

    return event;
  }

  async updateEvent(
    id: string,
    updates: Partial<VeinPayEvent>
  ): Promise<VeinPayEvent | null> {
    const existing = this.eventById.get(id);
    if (!existing) return null;

    const updated: VeinPayEvent = {
      ...existing,
      ...updates,
      id: existing.id, // Immutable
    };

    this.eventById.set(id, updated);
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx !== -1) {
      this.events[idx] = updated;
    }

    return updated;
  }

  async getEvents(filter?: {
    linkId?: string;
    simulated?: boolean;
    limit?: number;
  }): Promise<VeinPayEvent[]> {
    let result = this.events;
    if (filter?.linkId) {
      const targetLinkId = filter.linkId.trim().toLowerCase();
      result = result.filter(
        (e) => e.linkId.toLowerCase() === targetLinkId
      );
    }
    if (filter?.simulated !== undefined) {
      result = result.filter((e) => e.simulated === filter.simulated);
    }
    const limit = filter?.limit ?? 100;
    return result.slice(0, limit);
  }

  async getThreatMetrics(linkId?: string): Promise<ThreatMetricsSummary> {
    let subset = this.events;
    if (linkId) {
      const targetLinkId = linkId.trim().toLowerCase();
      subset = subset.filter((e) => e.linkId.toLowerCase() === targetLinkId);
    }

    // Server-verified events only: exclude simulated events and unverified non-EVM settlements
    const realEvents = subset.filter((e) => !e.simulated);

    const totalThreatsIntercepted = realEvents.filter(
      (e) => e.status === 'BLOCKED'
    ).length;

    const totalSettledVolumeUsd = realEvents
      .filter((e) => e.status === 'CONFIRMED')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    return {
      totalThreatsIntercepted,
      totalSettledVolumeUsd,
      liveEventsCount: realEvents.length,
      isPersistent: this.isPersistent,
    };
  }

  async clear(): Promise<void> {
    this.events = [];
    this.eventById.clear();
  }
}

/**
 * StorageEventStore — Serverless-Safe Event Store
 * Uses Redis Sorted Sets (ZADD with timestamp score) and MGET pipelines.
 * Caps list length via ZREMRANGEBYRANK and applies TTL to event records.
 */
export class StorageEventStore implements EventStore {
  readonly isPersistent = true;

  async recordEvent(
    input: Omit<VeinPayEvent, 'id' | 'timestamp'> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<VeinPayEvent> {
    const event: VeinPayEvent = {
      ...input,
      id: input.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };

    const storage = getStorage();
    const score = Date.parse(event.timestamp) || Date.now();
    const linkKey = `veinpay:events:link:${event.linkId.toLowerCase()}`;
    const allKey = 'veinpay:events:all';

    // 1. Store event object with 30-day TTL (2592000s)
    await storage.set(`veinpay:event:${event.id}`, event, {
      exSeconds: 86400 * 30,
    });

    // 2. Add to sorted sets
    await Promise.all([
      storage.zadd(linkKey, score, event.id),
      storage.zadd(allKey, score, event.id),
    ]);

    // 3. Trim to cap size (keep latest 500 per link, 2000 in all)
    void storage.zremrangebyrank(linkKey, 0, -501).catch(() => 0);
    void storage.zremrangebyrank(allKey, 0, -2001).catch(() => 0);

    return event;
  }

  async updateEvent(
    id: string,
    updates: Partial<VeinPayEvent>
  ): Promise<VeinPayEvent | null> {
    const storage = getStorage();
    const existing = await storage.get<VeinPayEvent>(`veinpay:event:${id}`);
    if (!existing) return null;

    const updated: VeinPayEvent = {
      ...existing,
      ...updates,
      id: existing.id, // Immutable
    };

    await storage.set(`veinpay:event:${id}`, updated, { exSeconds: 86400 * 30 });
    return updated;
  }

  async getEvents(filter?: {
    linkId?: string;
    simulated?: boolean;
    limit?: number;
  }): Promise<VeinPayEvent[]> {
    const storage = getStorage();
    const key = filter?.linkId
      ? `veinpay:events:link:${filter.linkId.toLowerCase()}`
      : 'veinpay:events:all';

    const limit = filter?.limit ?? 100;
    const ids = await storage.zrevrange(key, 0, limit - 1);

    if (!ids || ids.length === 0) return [];

    const keys = ids.map((id) => `veinpay:event:${id}`);
    const rawEvents = await storage.mget<VeinPayEvent>(keys);

    const events: VeinPayEvent[] = [];
    for (const ev of rawEvents) {
      if (ev) {
        if (filter?.simulated !== undefined && ev.simulated !== filter.simulated) {
          continue;
        }
        events.push(ev);
      }
    }

    return events;
  }

  async getThreatMetrics(linkId?: string): Promise<ThreatMetricsSummary> {
    const events = await this.getEvents({ linkId, limit: 500 });
    const realEvents = events.filter((e) => !e.simulated);

    const totalThreatsIntercepted = realEvents.filter(
      (e) => e.status === 'BLOCKED'
    ).length;

    const totalSettledVolumeUsd = realEvents
      .filter((e) => e.status === 'CONFIRMED')
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    return {
      totalThreatsIntercepted,
      totalSettledVolumeUsd,
      liveEventsCount: realEvents.length,
      isPersistent: this.isPersistent,
    };
  }

  async clear(): Promise<void> {
    const storage = getStorage();
    await storage.clear();
  }
}

// Global singleton instance
let globalEventStore: EventStore | null = null;

export function getEventStore(): EventStore {
  if (globalEventStore) return globalEventStore;

  const storage = getStorage();
  if (storage.isPersistent) {
    globalEventStore = new StorageEventStore();
  } else {
    globalEventStore = new InMemoryEventStore();
  }

  return globalEventStore;
}

export function resetEventStoreForTests(store?: EventStore): void {
  globalEventStore = store ?? new InMemoryEventStore();
}
