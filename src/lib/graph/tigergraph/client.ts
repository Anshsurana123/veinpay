import type { TigerGraphRestppEnvelope } from '@/types/veinpay';
import { getTigerGraphConfig, type TigerGraphConfig } from './config';
import { getTigerGraphAuthToken } from './auth';

export interface ExecuteQueryOptions {
  queryName: string;
  params: Record<string, unknown>;
  method?: 'POST' | 'GET';
  retries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Encodes vertex parameters for TigerGraph RESTPP 4.x/3.x queries.
 * In POST bodies: vertex arguments should be encoded as `{"id": "<address>", "type": "Address"}`
 * or plain string if the query accepts generic string IDs.
 */
export function formatVertexParam(id: string, vertexType = 'Address'): { id: string; type: string } {
  return { id, type: vertexType };
}

export async function executeTigerGraphQuery(
  options: ExecuteQueryOptions,
  overrideConfig?: TigerGraphConfig
): Promise<TigerGraphRestppEnvelope> {
  const config = overrideConfig || getTigerGraphConfig();
  if (!config) {
    return {
      version: { edition: 'enterprise', api: 'v2', schema: 0 },
      error: true,
      message: 'TigerGraph host is not configured (TIGERGRAPH_HOST missing).',
      results: [],
    };
  }

  const token = await getTigerGraphAuthToken(config);
  const { host, graph, timeoutMs } = config;
  const url = `${host}/restpp/query/${encodeURIComponent(graph)}/${encodeURIComponent(options.queryName)}`;

  const maxRetries = options.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(100 * Math.pow(2, attempt));
    }

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      let res: Response;
      if (options.method === 'GET') {
        const queryParams = new URLSearchParams();
        for (const [k, v] of Object.entries(options.params)) {
          if (v !== undefined && v !== null) {
            if (typeof v === 'object' && 'id' in v) {
              queryParams.set(k, String((v as { id: string }).id));
            } else {
              queryParams.set(k, String(v));
            }
          }
        }
        res = await fetch(`${url}?${queryParams.toString()}`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } else {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(options.params),
          signal: AbortSignal.timeout(timeoutMs),
        });
      }

      if (!res.ok) {
        // If 5xx or 429, retry
        if ((res.status >= 500 || res.status === 429) && attempt < maxRetries) {
          continue;
        }
        return {
          version: { edition: 'enterprise', api: 'v2', schema: 0 },
          error: true,
          message: `TigerGraph RESTPP query returned HTTP status ${res.status}.`,
          results: [],
        };
      }

      const envelope = (await res.json()) as TigerGraphRestppEnvelope;
      return envelope;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= maxRetries) {
        return {
          version: { edition: 'enterprise', api: 'v2', schema: 0 },
          error: true,
          message: `TigerGraph RESTPP query failed: ${lastError.message}`,
          results: [],
        };
      }
    }
  }

  return {
    version: { edition: 'enterprise', api: 'v2', schema: 0 },
    error: true,
    message: lastError ? lastError.message : 'TigerGraph query execution failed.',
    results: [],
  };
}
