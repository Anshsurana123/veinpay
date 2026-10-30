import type { GraphEdge, GraphVertex } from '@/types/veinpay';
import { getTigerGraphConfig, type TigerGraphConfig } from './config';
import { getTigerGraphAuthToken } from './auth';

export interface IngestGraphDataParams {
  vertices: Map<string, GraphVertex> | GraphVertex[];
  edges: GraphEdge[];
  inboundCompleteAddresses?: Set<string> | string[];
  overrideConfig?: TigerGraphConfig;
}

export async function batchUpsertToTigerGraph(
  params: IngestGraphDataParams
): Promise<{ success: boolean; count: number; error?: string }> {
  const config = params.overrideConfig || getTigerGraphConfig();
  if (!config) {
    return { success: false, count: 0, error: 'TigerGraph not configured' };
  }

  const token = await getTigerGraphAuthToken(config);
  const { host, graph, timeoutMs } = config;
  const url = `${host}/restpp/graph/${encodeURIComponent(graph)}`;

  const vList =
    params.vertices instanceof Map
      ? Array.from(params.vertices.values())
      : params.vertices;

  const inboundCompleteSet = new Set(
    params.inboundCompleteAddresses
      ? Array.from(params.inboundCompleteAddresses).map((a) => a.toLowerCase())
      : []
  );

  // Construct standard TigerGraph 4.x RESTPP upsert payload
  // Format:
  // {
  //   vertices: { Address: { "<id>": { "label": { "value": "..." }, ... } } },
  //   edges: { Address: { "<from_id>": { "FUNDED": { "Address": { "<to_id>": { "amount": { "value": ... } } } } } } }
  // }
  const vertexPayload: Record<string, Record<string, Record<string, unknown>>> = {
    Address: {},
  };

  for (const v of vList) {
    const isThreat = Boolean(v.isTainted);
    const riskTag = v.riskTag || (isThreat ? 'PHISHING_DRAINER' : 'PAYER_TARGET');
    const isHub = (v.riskTag as string) === 'CLEAN_INSTITUTIONAL';

    vertexPayload.Address[v.id] = {
      label: { value: v.label || '' },
      risk_category: { value: riskTag },
      is_flagged_threat: { value: isThreat },
      is_hub: { value: isHub },
      is_contract: { value: false },
      inbound_complete: { value: inboundCompleteSet.has(v.id.toLowerCase()) },
    };
  }

  const edgePayload: Record<
    string,
    Record<string, Record<string, Record<string, Record<string, unknown>>>>
  > = {
    Address: {},
  };

  function ensureEdgePath(fromId: string, edgeType: string, toId: string) {
    if (!edgePayload.Address[fromId]) edgePayload.Address[fromId] = {};
    if (!edgePayload.Address[fromId][edgeType]) edgePayload.Address[fromId][edgeType] = {};
    if (!edgePayload.Address[fromId][edgeType].Address) edgePayload.Address[fromId][edgeType].Address = {};
  }

  for (const e of params.edges) {
    const isDust = Boolean(e.attributes?.is_dust);
    const edgeType = isDust ? 'DUSTED' : (e.e_type || 'FUNDED');
    const txHash = e.attributes?.tx_hash || 'tx_default';

    ensureEdgePath(e.from_id, edgeType, e.to_id);

    edgePayload.Address[e.from_id][edgeType].Address[e.to_id] = {
      amount: { value: e.attributes?.amount || 0 },
      amount_usd: { value: e.attributes?.amount_usd || 0 },
      token: { value: e.attributes?.token || 'ETH' },
      block_number: { value: e.attributes?.block_number || 0 },
      tx_timestamp: { value: e.attributes?.timestamp || new Date().toISOString() },
      is_taint_path: { value: Boolean(e.attributes?.is_taint_path) },
    };
  }

  const payload = {
    vertices: vertexPayload,
    edges: edgePayload,
  };

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return {
        success: false,
        count: 0,
        error: `Upsert failed with HTTP ${res.status}`,
      };
    }

    return {
      success: true,
      count: vList.length + params.edges.length,
    };
  } catch (err) {
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
