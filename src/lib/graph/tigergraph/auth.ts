import type { TigerGraphConfig } from './config';

let cachedToken: { token: string; expiresAt: number } | null = null;

export function clearTigerGraphTokenCacheForTests(): void {
  cachedToken = null;
}

/**
 * Acquires a valid Bearer token for TigerGraph RESTPP API calls.
 * Uses TIGERGRAPH_TOKEN if explicitly set, or requests a JWT token via:
 * 1. TigerGraph 4.x: POST /gsql/v1/tokens
 * 2. Legacy TigerGraph 3.x fallback: POST /restpp/requesttoken
 */
export async function getTigerGraphAuthToken(
  config: TigerGraphConfig
): Promise<string | null> {
  if (config.token) {
    return config.token;
  }

  if (!config.secret) {
    return null;
  }

  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const { host, graph, secret, timeoutMs } = config;

  // 1. Try TigerGraph 4.x endpoint: POST /gsql/v1/tokens
  try {
    const res = await fetch(`${host}/gsql/v1/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        graph,
        lifetime: 604800000, // 7 days
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) {
      const data = (await res.json()) as { token?: string; error?: boolean };
      if (data.token && !data.error) {
        cachedToken = {
          token: data.token,
          expiresAt: Date.now() + 6 * 3600 * 1000, // cache for 6 hours
        };
        return data.token;
      }
    }
  } catch {
    // Fall through to legacy 3.x
  }

  // 2. Legacy TigerGraph 3.x fallback: POST /restpp/requesttoken
  try {
    const legacyRes = await fetch(`${host}/restpp/requesttoken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        graph,
        lifetime: 86400,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (legacyRes.ok) {
      const legacyData = (await legacyRes.json()) as { token?: string; error?: boolean };
      if (legacyData.token && !legacyData.error) {
        cachedToken = {
          token: legacyData.token,
          expiresAt: Date.now() + 3600 * 1000,
        };
        return legacyData.token;
      }
    }
  } catch {
    // Both failed
  }

  return null;
}
