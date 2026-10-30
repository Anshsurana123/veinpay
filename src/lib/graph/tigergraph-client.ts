import type {
  FirewallPolicyConfig,
  FirewallScanResult,
  GraphEdge,
  GraphVertex,
  TigerGraphRestppEnvelope,
} from '@/types/veilpay';
import {
  scanWithTigerGraph,
  buildTigerGraphFailClosedScan as buildFailClosed,
  batchUpsertToTigerGraph,
} from './tigergraph';

export { buildFailClosed as buildTigerGraphFailClosedScan };

export async function upsertGraphToTigerGraph(params: {
  vertices: Map<string, GraphVertex> | GraphVertex[];
  edges: GraphEdge[];
  graphName?: string;
}): Promise<boolean> {
  const res = await batchUpsertToTigerGraph({
    vertices: params.vertices,
    edges: params.edges,
  });
  return res.success;
}

/**
 * Executes live TigerGraph query without merging local mirror state!
 * Uses authoritative query results envelope from RESTPP.
 */
export async function tryExecuteLiveTigerGraphQuery(params: {
  targetWallet: string;
  merchantWallet: string;
  policy: FirewallPolicyConfig;
}): Promise<FirewallScanResult | null> {
  return scanWithTigerGraph({
    targetWallet: params.targetWallet,
    merchantWallet: params.merchantWallet,
    policy: params.policy,
  });
}
