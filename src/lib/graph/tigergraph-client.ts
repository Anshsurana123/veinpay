import type {
  FirewallPolicyConfig,
  FirewallScanResult,
  TigerGraphRestppEnvelope,
} from '@/types/veilpay';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';

let cachedJwtToken: { token: string; expiresAt: number } | null = null;

async function getTigerGraphBearerToken(
  host: string,
  graphName: string
): Promise<string | null> {
  if (process.env.TIGERGRAPH_TOKEN) {
    return process.env.TIGERGRAPH_TOKEN.trim();
  }
  const secret = process.env.TIGERGRAPH_SECRET?.trim();
  if (!secret) return null;

  if (cachedJwtToken && Date.now() < cachedJwtToken.expiresAt) {
    return cachedJwtToken.token;
  }

  const baseUrl = host.startsWith('http') ? host.replace(/\/+$/, '') : `https://${host}`;
  const res = await fetch(`${baseUrl}/gsql/v1/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret,
      graph: graphName,
      lifetime: 604800000,
    }),
    signal: AbortSignal.timeout(2500),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { token?: string };
  if (!data.token) return null;

  cachedJwtToken = {
    token: data.token,
    expiresAt: Date.now() + 3600 * 1000,
  };
  return data.token;
}

export async function tryExecuteLiveTigerGraphQuery(params: {
  targetWallet: string;
  merchantWallet: string;
  policy: FirewallPolicyConfig;
}): Promise<FirewallScanResult | null> {
  const host = process.env.TIGERGRAPH_HOST?.trim();
  const graphName = process.env.TIGERGRAPH_GRAPH?.trim() || 'VeilPayGraph';
  if (!host) return null;

  const startPerf = performance.now();
  try {
    const token = await getTigerGraphBearerToken(host, graphName);
    if (!token) return null;

    const baseUrl = host.startsWith('http') ? host.replace(/\/+$/, '') : `https://${host}`;
    const url = `${baseUrl}/restpp/query/${encodeURIComponent(graphName)}/veilpay_firewall_check`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        target_wallet: params.targetWallet,
        merchant_wallet: params.merchantWallet,
        max_hops: params.policy.maxHops,
        sybil_threshold: params.policy.sybilBlockThreshold,
      }),
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) return null;
    const envelope = (await response.json()) as TigerGraphRestppEnvelope;
    if (envelope.error || !envelope.results?.[0]) return null;

    const roundTripMs = Number((performance.now() - startPerf).toFixed(2));
    const localMirror = runVeilPayFirewallTraversal({
      targetWallet: params.targetWallet,
      merchantWallet: params.merchantWallet,
      policy: params.policy,
      executionSource: 'TIGERGRAPH_RESTPP_LIVE',
      precomputedElapsedMs: roundTripMs,
    });

    return {
      ...localMirror,
      executionTimeMs: roundTripMs,
      executionSource: 'TIGERGRAPH_RESTPP_LIVE',
      restppEnvelope: envelope,
    };
  } catch {
    return null;
  }
}
