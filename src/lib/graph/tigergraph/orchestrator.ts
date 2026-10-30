import type {
  FirewallPolicyConfig,
  FirewallScanResult,
  GraphEdge,
  GraphVertex,
  TigerGraphRestppEnvelope,
  VerdictStatus,
  HopDepth,
} from '@/types/veinpay';
import { getTigerGraphConfig } from './config';
import { executeTigerGraphQuery, formatVertexParam } from './client';
import { batchUpsertToTigerGraph } from './ingest';
import { crawlLiveAddressAndScan } from '@/lib/graph/live-crawler';
import { buildSeededGraphDataset } from '@/lib/graph/seed-topologies';

export interface ScanWithTigerGraphParams {
  targetWallet: string;
  merchantWallet?: string;
  chainId?: number;
  policy: FirewallPolicyConfig;
}

export function buildTigerGraphFailClosedScan(
  params: {
    targetWallet: string;
    merchantWallet?: string;
    policy: FirewallPolicyConfig;
  },
  failureReason: string,
  elapsedMs: number
): FirewallScanResult {
  const isBlock = (params.policy.inconclusivePolicy ?? 'BLOCK') === 'BLOCK';
  const targetWallet = params.targetWallet;
  const merchantWallet = params.merchantWallet ?? '';
  const maxHops = (params.policy.maxHops ?? 3) as HopDepth;

  const targetVertex: GraphVertex = {
    id: targetWallet,
    v_type: 'Wallet',
    label: `Unverified Wallet (${targetWallet.slice(0, 6)}...${targetWallet.slice(-4)})`,
    riskTag: 'INTERMEDIATE_MULE',
    hopDistance: 0,
    isTainted: false,
  };

  return {
    verdict: 'INCONCLUSIVE',
    socketUnlocked: !isBlock,
    vaultUriUnlocked: !isBlock,
    targetWallet,
    merchantWallet,
    maxHopsQueried: maxHops,
    policyApplied: params.policy,
    executionTimeMs: Math.max(0.2, Number(elapsedMs.toFixed(2))),
    executionSource: 'TIGERGRAPH_RESTPP_LIVE',
    minTaintHop: 999999,
    taintHits: 0,
    taintedRootEntities: [],
    sybilClusterSize: 1,
    sybilRootFunder: null,
    sybilSiblingWallets: [],
    cyclicLoopDetected: false,
    detectedCyclePaths: [],
    selfTransferDetected: false,
    dustOutDegree: 0,
    nodesScanned: 1,
    edgesTraversed: 0,
    shallowScanAdvisory: null,
    liveCrawlNotes: null,
    gsqlQuerySnippet: '',
    inconclusiveReason: failureReason,
    vertices: [targetVertex],
    edges: [],
    evidenceEdges: [],
    restppEnvelope: {
      version: { edition: 'enterprise', api: 'v2', schema: 1 },
      error: true,
      message: failureReason,
      results: [
        {
          verdict: 'INCONCLUSIVE',
          target_wallet: targetWallet,
          merchant_wallet: merchantWallet,
          max_hops_queried: maxHops,
          min_taint_hop: 999999,
          taint_hits: 0,
          sybil_cluster_size: 1,
          sybil_root_funder: '',
          cyclic_loop_detected: false,
          self_transfer_detected: false,
          dust_out_degree: 0,
          nodes_scanned: 1,
          edges_traversed: 0,
          '@@evidence_edges': [],
        },
      ],
    },
    timestamp: new Date().toISOString(),
  };
}

export async function scanWithTigerGraph(
  params: ScanWithTigerGraphParams
): Promise<FirewallScanResult | null> {
  const config = getTigerGraphConfig();
  if (!config) return null;

  const startPerf = performance.now();
  const targetWallet = params.targetWallet;
  const merchantWallet = params.merchantWallet || targetWallet;
  const maxHops = params.policy.maxHops;

  const queryParams = {
    target_wallet: formatVertexParam(targetWallet),
    merchant_wallet: formatVertexParam(merchantWallet),
    max_hops: maxHops,
    sybil_threshold: params.policy.sybilBlockThreshold,
    clean_link_enabled: params.policy.cleanLinkEnabled,
    unbundle_enabled: params.policy.unbundleEnabled,
    firewall_enabled: params.policy.firewallEnabled,
  };

  let envelope = await executeTigerGraphQuery({
    queryName: 'veinpay_firewall_check',
    params: queryParams,
  });

  // If vertex was not found in TigerGraph, automatically seed or upsert and retry
  if (
    envelope.error &&
    (envelope.message?.includes('Failed to convert user vertex id') ||
      envelope.message?.includes('invalid vertex id') ||
      envelope.message?.includes('REST-30000'))
  ) {
    try {
      const seedData = buildSeededGraphDataset();
      if (seedData.vertices.has(targetWallet.toLowerCase())) {
        await batchUpsertToTigerGraph({
          vertices: seedData.vertices,
          edges: seedData.edges,
        });
      } else {
        await batchUpsertToTigerGraph({
          vertices: [
            {
              id: targetWallet,
              v_type: 'Wallet' as const,
              label: `Wallet (${targetWallet.slice(0, 6)}...${targetWallet.slice(-4)})`,
              riskTag: 'PAYER_TARGET' as const,
              hopDistance: 0,
              isTainted: false,
            },
            ...(merchantWallet && merchantWallet !== targetWallet
              ? [
                  {
                    id: merchantWallet,
                    v_type: 'Merchant' as const,
                    label: `Merchant (${merchantWallet.slice(0, 6)}...${merchantWallet.slice(-4)})`,
                    riskTag: 'CLEAN' as const,
                    hopDistance: 0,
                    isTainted: false,
                  },
                ]
              : []),
          ],
          edges: [],
        });
      }

      envelope = await executeTigerGraphQuery({
        queryName: 'veinpay_firewall_check',
        params: queryParams,
      });
    } catch {
      // Ignore upsert error, will fall through to fail-closed scan
    }
  }

  const elapsedMs = performance.now() - startPerf;

  if (envelope.error || !envelope.results?.[0]) {
    return buildTigerGraphFailClosedScan(
      { targetWallet, merchantWallet, policy: params.policy },
      envelope.message || 'TigerGraph RESTPP query failed or returned no results envelope.',
      elapsedMs
    );
  }

  const tgResult = envelope.results[0] as Record<string, any>;
  const nodesScanned = Number(tgResult.nodes_scanned) || 0;

  // If target vertex does not exist in graph (nodes_scanned == 0) and live crawler is available, crawl and upsert
  if (nodesScanned === 0 && (process.env.ETHERSCAN_API_KEY || process.env.ALCHEMY_API_KEY)) {
    const liveCrawlRes = await crawlLiveAddressAndScan({
      targetWallet,
      merchantWallet,
      chainId: params.chainId || 1,
      policy: params.policy,
    });

    if (liveCrawlRes.vertices.length > 0) {
      await batchUpsertToTigerGraph({
        vertices: liveCrawlRes.vertices,
        edges: liveCrawlRes.edges,
      });

      // Re-query TigerGraph
      const reEnvelope = await executeTigerGraphQuery({
        queryName: 'veinpay_firewall_check',
        params: queryParams,
      });

      if (!reEnvelope.error && reEnvelope.results?.[0]) {
        return parseTigerGraphResultEnvelope(
          reEnvelope,
          params,
          performance.now() - startPerf
        );
      }
    }
  }

  return parseTigerGraphResultEnvelope(envelope, params, elapsedMs);
}

function parseTigerGraphResultEnvelope(
  envelope: TigerGraphRestppEnvelope,
  params: ScanWithTigerGraphParams,
  elapsedMs: number
): FirewallScanResult {
  const tgResult = envelope.results![0] as Record<string, any>;
  const verdict = (tgResult.verdict as VerdictStatus) || 'VERIFIED_CLEAN';
  const minTaintHop = Number(tgResult.min_taint_hop ?? 999999);
  const taintHits = Number(tgResult.taint_hits ?? 0);
  const sybilClusterSize = Number(tgResult.sybil_cluster_size ?? 1);
  const dustOutDegree = Number(tgResult.dust_out_degree ?? 0);
  const cyclicLoopDetected = Boolean(tgResult.cyclic_loop_detected);
  const selfTransferDetected = Boolean(tgResult.self_transfer_detected);
  const nodesScanned = Math.max(1, Number(tgResult.nodes_scanned ?? 1));
  const edgesTraversed = Number(tgResult.edges_traversed ?? 0);

  const sybilRootFunders: string[] = Array.isArray(tgResult.sybil_root_funders)
    ? tgResult.sybil_root_funders
    : [];
  const sybilRootFunder = sybilRootFunders.length > 0 ? sybilRootFunders[0] : null;

  // Parse evidence edges from @@evidence_edges accumulator
  const rawEdges = Array.isArray(tgResult['@@evidence_edges'])
    ? tgResult['@@evidence_edges']
    : [];

  const evidenceEdges: GraphEdge[] = [];
  const vertexMap = new Map<string, GraphVertex>();

  const targetV: GraphVertex = {
    id: params.targetWallet,
    v_type: 'Wallet',
    label: `Target Wallet (${params.targetWallet.slice(0, 6)}...${params.targetWallet.slice(-4)})`,
    riskTag: verdict === 'INTERCEPTED_TAINT' ? 'APPROVAL_DRAINER' : 'PAYER_TARGET',
    hopDistance: 0,
    isTainted: verdict === 'INTERCEPTED_TAINT',
  };
  vertexMap.set(params.targetWallet.toLowerCase(), targetV);

  for (const re of rawEdges) {
    const fromId = String(re.from_id || re.from || '');
    const toId = String(re.to_id || re.to || '');
    if (!fromId || !toId) continue;

    const hop = Number(re.attributes?.hop_distance ?? re.hop_distance ?? 1);
    const amount = Number(re.attributes?.amount ?? re.amount ?? 0);
    const amountUsd = Number(re.attributes?.amount_usd ?? re.amount_usd ?? 0);
    const token = String(re.attributes?.token ?? re.token ?? 'ETH');
    const txHash = String(re.attributes?.tx_hash ?? re.tx_hash ?? '');
    const isTaintPath = Boolean(re.attributes?.is_taint_path ?? re.is_taint_path);

    if (!vertexMap.has(fromId.toLowerCase())) {
      vertexMap.set(fromId.toLowerCase(), {
        id: fromId,
        v_type: 'Wallet',
        label: `Ancestor (${fromId.slice(0, 6)}...${fromId.slice(-4)})`,
        riskTag: isTaintPath ? 'APPROVAL_DRAINER' : 'INTERMEDIATE_MULE',
        hopDistance: hop,
        isTainted: isTaintPath,
      });
    }

    evidenceEdges.push({
      id: `tg-${txHash.slice(0, 16) || fromId.slice(0, 8)}-${hop}`,
      e_type: 'TRANSFERRED_TO',
      from_id: fromId,
      from_type: 'Wallet',
      to_id: toId,
      to_type: 'Wallet',
      attributes: {
        amount,
        amount_usd: amountUsd,
        token,
        tx_hash: txHash,
        block_number: 0,
        timestamp: new Date().toISOString(),
        hop_distance: hop,
        is_taint_path: isTaintPath,
      },
    });
  }

  const socketUnlocked =
    verdict === 'VERIFIED_CLEAN' ||
    verdict === 'WARNING_SYBIL' ||
    verdict === 'ADVISORY_BYPASSED';
  const vaultUriUnlocked = socketUnlocked;

  return {
    verdict,
    socketUnlocked,
    vaultUriUnlocked,
    targetWallet: params.targetWallet,
    merchantWallet: params.merchantWallet || '',
    maxHopsQueried: params.policy.maxHops,
    policyApplied: params.policy,
    executionTimeMs: Math.max(0.15, Number(elapsedMs.toFixed(2))),
    executionSource: 'TIGERGRAPH_RESTPP_LIVE',
    minTaintHop,
    taintHits,
    taintedRootEntities: [],
    sybilClusterSize,
    sybilRootFunder,
    sybilSiblingWallets: [],
    cyclicLoopDetected,
    detectedCyclePaths: [],
    selfTransferDetected,
    dustOutDegree,
    nodesScanned,
    edgesTraversed,
    shallowScanAdvisory: null,
    liveCrawlNotes: null,
    gsqlQuerySnippet: '',
    inconclusiveReason: null,
    vertices: Array.from(vertexMap.values()),
    edges: evidenceEdges,
    evidenceEdges,
    restppEnvelope: envelope,
    timestamp: new Date().toISOString(),
  };
}
