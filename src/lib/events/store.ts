import type { ThreatMetricsSummary, VeilPayEvent } from './types';

export interface EventStore {
  readonly isPersistent: boolean;
  recordEvent(
    event: Omit<VeilPayEvent, 'id' | 'timestamp'> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<VeilPayEvent>;
  updateEvent(
    id: string,
    updates: Partial<VeilPayEvent>
  ): Promise<VeilPayEvent | null>;
  getEvents(filter?: {
    linkId?: string;
    simulated?: boolean;
    limit?: number;
  }): Promise<VeilPayEvent[]>;
  getThreatMetrics(linkId?: string): Promise<ThreatMetricsSummary>;
  clear(): Promise<void>;
}

export class InMemoryEventStore implements EventStore {
  readonly isPersistent = false;
  private events: VeilPayEvent[] = [];
  private eventById = new Map<string, VeilPayEvent>();

  async recordEvent(
    input: Omit<VeilPayEvent, 'id' | 'timestamp'> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<VeilPayEvent> {
    const event: VeilPayEvent = {
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
    updates: Partial<VeilPayEvent>
  ): Promise<VeilPayEvent | null> {
    const existing = this.eventById.get(id);
    if (!existing) return null;

    const updated: VeilPayEvent = {
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
  }): Promise<VeilPayEvent[]> {
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

    // CRITICAL: Simulated events MUST BE EXCLUDED from production threat metrics & counters
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

export class RedisRestEventStore implements EventStore {
  readonly isPersistent = true;
  private readonly restUrl: string;
  private readonly restToken: string;

  constructor(restUrl: string, restToken: string) {
    this.restUrl = restUrl.replace(/\/+$/, '');
    this.restToken = restToken;
  }

  private async executeCommand<T>(command: (string | number)[]): Promise<T> {
    const res = await fetch(this.restUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(3500),
    });

    if (!res.ok) {
      throw new Error(`Upstash Redis REST error: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { result: T };
    return data.result;
  }

  async recordEvent(
    input: Omit<VeilPayEvent, 'id' | 'timestamp'> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<VeilPayEvent> {
    const event: VeilPayEvent = {
      ...input,
      id: input.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };

    const eventJson = JSON.stringify(event);

    await Promise.all([
      this.executeCommand(['SET', `veilpay:event:${event.id}`, eventJson]),
      this.executeCommand(['LPUSH', 'veilpay:events:all', event.id]),
      this.executeCommand([
        'LPUSH',
        `veilpay:events:link:${event.linkId.toLowerCase()}`,
        event.id,
      ]),
    ]);

    return event;
  }

  async updateEvent(
    id: string,
    updates: Partial<VeilPayEvent>
  ): Promise<VeilPayEvent | null> {
    const raw = await this.executeCommand<string | null>([
      'GET',
      `veilpay:event:${id}`,
    ]);
    if (!raw) return null;

    const existing = JSON.parse(raw) as VeilPayEvent;
    const updated: VeilPayEvent = {
      ...existing,
      ...updates,
      id: existing.id, // Immutable
    };

    await this.executeCommand([
      'SET',
      `veilpay:event:${id}`,
      JSON.stringify(updated),
    ]);

    return updated;
  }

  async getEvents(filter?: {
    linkId?: string;
    simulated?: boolean;
    limit?: number;
  }): Promise<VeilPayEvent[]> {
    const key = filter?.linkId
      ? `veilpay:events:link:${filter.linkId.toLowerCase()}`
      : 'veilpay:events:all';

    const limit = filter?.limit ?? 100;
    const ids = await this.executeCommand<string[]>([
      'LRANGE',
      key,
      0,
      limit - 1,
    ]);

    if (!ids || ids.length === 0) return [];

    const events: VeilPayEvent[] = [];
    for (const id of ids) {
      const raw = await this.executeCommand<string | null>([
        'GET',
        `veilpay:event:${id}`,
      ]);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as VeilPayEvent;
          if (
            filter?.simulated !== undefined &&
            parsed.simulated !== filter.simulated
          ) {
            continue;
          }
          events.push(parsed);
        } catch {
          // Skip corrupt rows
        }
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
    // Used in tests if needed
  }
}

// Global singleton instance
let globalEventStore: EventStore | null = null;

export function getEventStore(): EventStore {
  if (globalEventStore) return globalEventStore;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (url && token) {
    globalEventStore = new RedisRestEventStore(url, token);
  } else {
    globalEventStore = new InMemoryEventStore();
  }

  return globalEventStore;
}

export function resetEventStoreForTests(store?: EventStore): void {
  globalEventStore = store ?? new InMemoryEventStore();
}
