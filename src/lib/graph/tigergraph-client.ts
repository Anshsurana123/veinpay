import type {
  FirewallPolicyConfig,
  FirewallScanResult,
  GraphEdge,
  GraphVertex,
  TigerGraphRestppEnvelope,
  VerdictStatus,
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

export async function upsertGraphToTigerGraph(params: {
  vertices: Map<string, GraphVertex> | GraphVertex[];
  edges: GraphEdge[];
  graphName?: string;
}): Promise<boolean> {
  const host = process.env.TIGERGRAPH_HOST?.trim();
  const graphName =
    params.graphName || process.env.TIGERGRAPH_GRAPH?.trim() || 'VeilPayGraph';
  if (!host) return false;

  try {
    const token = await getTigerGraphBearerToken(host, graphName);
    if (!token) return false;

    const baseUrl = host.startsWith('http') ? host.replace(/\/+$/, '') : `https://${host}`;
    const url = `${baseUrl}/restpp/graph/${encodeURIComponent(graphName)}`;

    const vertexObj: Record<string, Record<string, Record<string, unknown>>> = {
      Wallet: {},
      ThreatEntity: {},
      Merchant: {},
    };

    const vList =
      params.vertices instanceof Map
        ? Array.from(params.vertices.values())
        : params.vertices;

    for (const v of vList) {
      const vType = v.v_type || 'Wallet';
      if (!vertexObj[vType]) vertexObj[vType] = {};
      vertexObj[vType][v.id] = {
        label: { value: v.label || '' },
        risk_tag: { value: v.riskTag || 'PAYER_TARGET' },
        chain_id: { value: v.chainId || 1 },
        is_flagged_threat: { value: Boolean(v.isTainted) },
      };
    }

    const edgeObj: Record<
      string,
      Record<string, Record<string, Record<string, Record<string, unknown>>>>
    > = {
      Wallet: {},
      ThreatEntity: {},
      Merchant: {},
    };

    for (const e of params.edges) {
      const fromType = e.from_type || 'Wallet';
      const toType = e.to_type || 'Wallet';
      const eType = e.e_type || 'TRANSFERRED_TO';

      if (!edgeObj[fromType]) edgeObj[fromType] = {};
      if (!edgeObj[fromType][e.from_id]) edgeObj[fromType][e.from_id] = {};
      if (!edgeObj[fromType][e.from_id][eType]) edgeObj[fromType][e.from_id][eType] = {};

      edgeObj[fromType][e.from_id][eType][toType] = {
        [e.to_id]: {
          amount: { value: e.attributes?.amount || 0 },
          amount_usd: { value: e.attributes?.amount_usd || 0 },
          token: { value: e.attributes?.token || 'ETH' },
          tx_hash: { value: e.attributes?.tx_hash || '' },
        },
      };
    }

    const payload = {
      vertices: vertexObj,
      edges: edgeObj,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });

    return res.ok;
  } catch {
    return false;
  }
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
    if (!token) {
      return buildTigerGraphFailClosedScan(
        params,
        'Failed to acquire TigerGraph auth token from TIGERGRAPH_SECRET or TIGERGRAPH_TOKEN.',
        performance.now() - startPerf
      );
    }

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
        clean_link_enabled: params.policy.cleanLinkEnabled,
        unbundle_enabled: params.policy.unbundleEnabled,
        firewall_enabled: params.policy.firewallEnabled,
      }),
      signal: AbortSignal.timeout(3000),
    });

    const roundTripMs = Number((performance.now() - startPerf).toFixed(2));

    if (!response.ok) {
      return buildTigerGraphFailClosedScan(
        params,
        `TigerGraph RESTPP query returned HTTP status ${response.status}.`,
        roundTripMs
      );
    }

    const envelope = (await response.json()) as TigerGraphRestppEnvelope;
    if (envelope.error || !envelope.results?.[0]) {
      return buildTigerGraphFailClosedScan(
        params,
        `TigerGraph RESTPP query failed: ${envelope.message || 'No results envelope returned.'}`,
        roundTripMs
      );
    }

    const localMirror = runVeilPayFirewallTraversal({
      targetWallet: params.targetWallet,
      merchantWallet: params.merchantWallet,
      policy: params.policy,
      executionSource: 'TIGERGRAPH_RESTPP_LIVE',
      precomputedElapsedMs: roundTripMs,
    });

    const res = envelope.results[0];
    const liveVerdict = (res.verdict as VerdictStatus) || localMirror.verdict;
    const isUnlocked =
      !params.policy.firewallEnabled ||
      liveVerdict === 'VERIFIED_CLEAN' ||
      liveVerdict === 'WARNING_SYBIL';
    const taintHits =
      typeof res.taint_hits === 'number' ? res.taint_hits : localMirror.taintHits;
    const minTaintHop =
      typeof res.min_taint_hop === 'number' && res.min_taint_hop < 999999
        ? res.min_taint_hop
        : localMirror.minTaintHop;
    const sybilClusterSize =
      typeof res.sybil_cluster_size === 'number'
        ? res.sybil_cluster_size
        : localMirror.sybilClusterSize;
    const dustOutDegree =
      typeof res.dust_out_degree === 'number'
        ? res.dust_out_degree
        : localMirror.dustOutDegree;
    const cyclicLoopDetected =
      typeof res.cyclic_loop_detected === 'boolean'
        ? res.cyclic_loop_detected
        : localMirror.cyclicLoopDetected;
    const selfTransferDetected =
      typeof res.self_transfer_detected === 'boolean'
        ? res.self_transfer_detected
        : localMirror.selfTransferDetected;
    const nodesScanned =
      typeof res.nodes_scanned === 'number'
        ? res.nodes_scanned
        : localMirror.nodesScanned;
    const edgesTraversed =
      typeof res.edges_traversed === 'number'
        ? res.edges_traversed
        : localMirror.edgesTraversed;

    return {
      ...localMirror,
      verdict: liveVerdict,
      socketUnlocked: isUnlocked,
      vaultUriUnlocked: isUnlocked,
      taintHits,
      minTaintHop,
      sybilClusterSize,
      dustOutDegree,
      cyclicLoopDetected,
      selfTransferDetected,
      nodesScanned,
      edgesTraversed,
      executionTimeMs: roundTripMs,
      executionSource: 'TIGERGRAPH_RESTPP_LIVE',
      restppEnvelope: envelope,
    };
  } catch (err) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return buildTigerGraphFailClosedScan(
      params,
      `TigerGraph RESTPP query failed: ${err instanceof Error ? err.message : 'timeout or network error'}.`,
      elapsedMs
    );
  }
}

export function buildTigerGraphFailClosedScan(
  params: {
    targetWallet: string;
    merchantWallet: string;
    policy: FirewallPolicyConfig;
  },
  failureReason: string,
  elapsedMs: number
): FirewallScanResult {
  const isUnlocked =
    !params.policy.firewallEnabled ||
    params.policy.inconclusivePolicy === 'WARN';

  return {
    verdict: 'INCONCLUSIVE',
    socketUnlocked: isUnlocked,
    vaultUriUnlocked: isUnlocked,
    targetWallet: params.targetWallet,
    merchantWallet: params.merchantWallet,
    maxHopsQueried: params.policy.maxHops,
    policyApplied: params.policy,
    executionTimeMs: elapsedMs,
    executionSource: 'TIGERGRAPH_RESTPP_LIVE',
    minTaintHop: null,
    taintHits: 0,
    taintedRootEntities: [],
    sybilClusterSize: 1,
    sybilRootFunder: null,
    sybilSiblingWallets: [],
    cyclicLoopDetected: false,
    detectedCyclePaths: [],
    selfTransferDetected: false,
    dustOutDegree: 0,
    nodesScanned: 0,
    edgesTraversed: 0,
    shallowScanAdvisory: null,
    liveCrawlNotes: null,
    inconclusiveReason: failureReason,
    vertices: [],
    edges: [],
    evidenceEdges: [],
    restppEnvelope: {
      version: {
        edition: 'enterprise',
        api: 'v2',
        schema: 0,
      },
      error: true,
      message: failureReason,
      results: [],
    },
    gsqlQuerySnippet: `// TigerGraph RESTPP fail-closed fallback\nRUN QUERY veilpay_firewall_check("${params.targetWallet}", "${params.merchantWallet}", ${params.policy.maxHops}, ${params.policy.sybilBlockThreshold}, ${params.policy.cleanLinkEnabled}, ${params.policy.unbundleEnabled}, ${params.policy.firewallEnabled});`,
    timestamp: new Date().toISOString(),
  };
}
