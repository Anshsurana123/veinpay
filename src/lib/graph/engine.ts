import type {
  ExecutionEngineSource,
  FirewallPolicyConfig,
  FirewallScanResult,
  GraphEdge,
  GraphVertex,
  HopDepth,
  RiskCategory,
  TigerGraphRestppEnvelope,
  VerdictStatus,
} from '@/types/veilpay';
import threatSnapshot from '@/data/threat-intel-snapshot.json';
import {
  DEMO_ADDRESS_ALIASES,
  toEip55Address,
} from '@/lib/validators/address';
import {
  buildSeededGraphDataset,
  type SeedGraphDataset,
} from '@/lib/graph/seed-topologies';

const THREAT_SNAPSHOT_MAP = new Map<
  string,
  { address: string; label: string; riskCategory: RiskCategory; source: string }
>(
  threatSnapshot.entities.map((e) => [
    e.address.toLowerCase(),
    {
      address: e.address,
      label: e.label,
      riskCategory: e.riskCategory as RiskCategory,
      source: e.source,
    },
  ])
);

const INSTITUTIONAL_WHITELIST = new Set<string>([
  '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443', // Uniswap V3 Pool
  '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43', // Coinbase Hot Wallet
  '0x55fe002aeff02f77364de339a1292923a15844b8', // Circle Treasury
  '0x794a61358d6845594f94dc1db02a252b5b4814ad', // Aave V3 Pool
  '0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a', // Arbitrum Bridge
  '0x61f4b2001122334455667788990011223344b209', // Camelot DEX Router
]);

export function resolveCanonicalWalletInput(rawAddress: string): string {
  const trimmed = rawAddress.trim();
  const alias = DEMO_ADDRESS_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return toEip55Address(trimmed);
  }
  return trimmed;
}

export function buildGsqlQuerySnippet(
  targetWallet: string,
  merchantWallet: string,
  maxHops: HopDepth,
  sybilThreshold: number
): string {
  return `// Executed on TigerGraph Graph: VeilPayGraph (SYNTAX v2)
INTERPRET QUERY veilpay_firewall_check(
  target_wallet    = "${targetWallet}",
  merchant_wallet  = "${merchantWallet}",
  max_hops         = ${maxHops},
  sybil_threshold  = ${sybilThreshold}
) FOR GRAPH VeilPayGraph;`;
}

export interface RunTraversalOptions {
  targetWallet: string;
  merchantWallet?: string;
  policy: FirewallPolicyConfig;
  customDataset?: SeedGraphDataset;
  executionSource?: ExecutionEngineSource;
  liveCrawlNotes?: string | null;
  crawlTruncated?: boolean;
  isInconclusive?: boolean;
  inconclusiveReason?: string | null;
  precomputedElapsedMs?: number;
}

export function runVeilPayFirewallTraversal(
  options: RunTraversalOptions
): FirewallScanResult {
  const startPerf = performance.now();

  const targetCanonical = resolveCanonicalWalletInput(options.targetWallet);
  const targetLower = targetCanonical.toLowerCase();
  const merchantCanonical = options.merchantWallet
    ? resolveCanonicalWalletInput(options.merchantWallet)
    : '';
  const policy = options.policy;
  const maxHops = Math.min(5, Math.max(1, Number(policy.maxHops) || 3)) as HopDepth;

  const dataset = options.customDataset ?? buildSeededGraphDataset();

  // Build reverse (inbound) and forward (outbound) adjacency lists
  const inboundTransferred = new Map<string, GraphEdge[]>();
  const outboundTransferred = new Map<string, GraphEdge[]>();
  const outboundDusted = new Map<string, GraphEdge[]>();

  for (const edge of dataset.edges) {
    const fromL = edge.from_id.toLowerCase();
    const toL = edge.to_id.toLowerCase();

    if (edge.e_type === 'TRANSFERRED_TO') {
      const inList = inboundTransferred.get(toL) ?? [];
      inList.push(edge);
      inboundTransferred.set(toL, inList);

      const outList = outboundTransferred.get(fromL) ?? [];
      outList.push(edge);
      outboundTransferred.set(fromL, outList);
    } else if (edge.e_type === 'DUSTED') {
      const dustList = outboundDusted.get(fromL) ?? [];
      dustList.push(edge);
      outboundDusted.set(fromL, dustList);
    }
  }

  // Ensure target vertex exists in working map
  const workingVertices = new Map<string, GraphVertex>();
  const seedTargetVertex = dataset.vertices.get(targetLower);

  const snapshotHitOnTarget = THREAT_SNAPSHOT_MAP.get(targetLower);
  const initialTargetVertex: GraphVertex = seedTargetVertex
    ? { ...seedTargetVertex, hopDistance: 0, riskTag: 'PAYER_TARGET' }
    : {
        id: targetCanonical,
        v_type: snapshotHitOnTarget ? 'ThreatEntity' : 'Wallet',
        label: snapshotHitOnTarget
          ? snapshotHitOnTarget.label
          : `Payer Wallet (${targetCanonical.slice(0, 6)}...${targetCanonical.slice(-4)})`,
        riskTag: snapshotHitOnTarget ? snapshotHitOnTarget.riskCategory : 'PAYER_TARGET',
        hopDistance: 0,
        isTainted: Boolean(snapshotHitOnTarget),
        threatSource: snapshotHitOnTarget?.source,
      };

  workingVertices.set(targetLower, initialTargetVertex);

  // GSQL-equivalent accumulators
  const visitedVertices = new Set<string>([targetLower]);
  const minHopByVertex = new Map<string, number>([[targetLower, 0]]);
  const parentEdgeByVertex = new Map<string, GraphEdge>();
  const traversedEdgesMap = new Map<string, GraphEdge>();

  let nodesScanned = 1;
  let edgesTraversed = 0;
  let minTaintHop: number | null = initialTargetVertex.isTainted ? 0 : null;
  let taintHits = initialTargetVertex.isTainted ? 1 : 0;
  const taintedRootEntities: GraphVertex[] = initialTargetVertex.isTainted
    ? [initialTargetVertex]
    : [];

  let cyclicLoopDetected = false;
  let selfTransferDetected = false;
  const detectedCyclePaths: string[][] = [];

  // ==========================================================================
  // STEP 1: Multi-Hop Backward Lineage BFS (Hops 1 .. maxHops)
  // ==========================================================================
  let currentFrontier: string[] = [targetLower];

  for (let hop = 1; hop <= maxHops; hop++) {
    if (currentFrontier.length === 0) break;
    const nextFrontier: string[] = [];

    for (const currentAddr of currentFrontier) {
      const inboundEdges = inboundTransferred.get(currentAddr) ?? [];

      for (const rawEdge of inboundEdges) {
        edgesTraversed += 1;
        const fromLower = rawEdge.from_id.toLowerCase();
        const toLower = rawEdge.to_id.toLowerCase();

        const seedFrom = dataset.vertices.get(fromLower);
        const snapshotThreat = THREAT_SNAPSHOT_MAP.get(fromLower);
        const isVertexThreat =
          Boolean(seedFrom?.isTainted) ||
          seedFrom?.v_type === 'ThreatEntity' ||
          Boolean(snapshotThreat);

        // Clone edge with exact measured hop_distance
        const edgeCopy: GraphEdge = {
          ...rawEdge,
          attributes: {
            ...rawEdge.attributes,
            hop_distance: hop,
          },
        };

        // Case 2A: Self-transfer detection (u == v)
        if (fromLower === toLower) {
          selfTransferDetected = true;
          cyclicLoopDetected = true;
          edgeCopy.attributes.is_cyclic_edge = true;
          traversedEdgesMap.set(edgeCopy.id, edgeCopy);
          detectedCyclePaths.push([rawEdge.from_id, rawEdge.to_id]);
          continue;
        }

        // Case 2B: Cyclic wash-ring detection (backward edge reaches already-visited vertex)
        if (visitedVertices.has(fromLower)) {
          // Check if there is also a directed cycle back to target or current frontier
          const hasReturnEdge = (inboundTransferred.get(fromLower) ?? []).some(
            (e) => visitedVertices.has(e.from_id.toLowerCase())
          );
          if (fromLower === targetLower || hasReturnEdge || edgeCopy.attributes.is_cyclic_edge) {
            cyclicLoopDetected = true;
            edgeCopy.attributes.is_cyclic_edge = true;
            detectedCyclePaths.push([rawEdge.from_id, rawEdge.to_id, targetCanonical]);
          }
          traversedEdgesMap.set(edgeCopy.id, edgeCopy);
          continue;
        }

        // Materialize ancestor vertex at this hop
        const ancestorVertex: GraphVertex = seedFrom
          ? {
              ...seedFrom,
              hopDistance: hop,
              isTainted: isVertexThreat,
              riskTag: isVertexThreat
                ? snapshotThreat?.riskCategory ?? seedFrom.riskTag
                : seedFrom.riskTag,
              threatSource: seedFrom.threatSource ?? snapshotThreat?.source,
            }
          : {
              id: rawEdge.from_id,
              v_type: isVertexThreat ? 'ThreatEntity' : 'Wallet',
              label:
                snapshotThreat?.label ??
                `Ancestor Hop ${hop} (${rawEdge.from_id.slice(0, 6)}...${rawEdge.from_id.slice(-4)})`,
              riskTag: isVertexThreat
                ? snapshotThreat?.riskCategory ?? 'APPROVAL_DRAINER'
                : 'INTERMEDIATE_MULE',
              hopDistance: hop,
              isTainted: isVertexThreat,
              threatSource: snapshotThreat?.source,
            };

        visitedVertices.add(fromLower);
        minHopByVertex.set(fromLower, hop);
        parentEdgeByVertex.set(fromLower, edgeCopy);
        workingVertices.set(fromLower, ancestorVertex);
        traversedEdgesMap.set(edgeCopy.id, edgeCopy);
        nodesScanned += 1;

        // CleanLink Taint Inspection
        if (isVertexThreat) {
          taintHits += 1;
          if (minTaintHop === null || hop < minTaintHop) {
            minTaintHop = hop;
          }
          taintedRootEntities.push(ancestorVertex);

          // Back-propagate taint path flag from this threat entity down to targetWallet
          edgeCopy.attributes.is_taint_path = true;
          let traceCursor = toLower;
          let safety = 0;
          while (traceCursor !== targetLower && safety < 10) {
            safety += 1;
            const intermediateV = workingVertices.get(traceCursor);
            if (intermediateV) {
              intermediateV.isTainted = true;
            }
            const downEdge = parentEdgeByVertex.get(traceCursor);
            if (!downEdge) break;
            downEdge.attributes.is_taint_path = true;
            traceCursor = downEdge.to_id.toLowerCase();
          }
        }

        nextFrontier.push(fromLower);
      }
    }

    currentFrontier = nextFrontier;
  }

  // Check if deeper uninspected hops exist beyond maxHops (Case 1 boundary advisory)
  let uninspectedDeeperEdgesCount = 0;
  for (const frontierAddr of currentFrontier) {
    const deeperInbound = inboundTransferred.get(frontierAddr) ?? [];
    for (const de of deeperInbound) {
      if (!visitedVertices.has(de.from_id.toLowerCase())) {
        uninspectedDeeperEdgesCount += 1;
      }
    }
  }

  const shallowScanAdvisory =
    taintHits === 0 && uninspectedDeeperEdgesCount > 0 && maxHops < 4
      ? `Scanned up to ${maxHops} ${maxHops === 1 ? 'hop' : 'hops'}: ${uninspectedDeeperEdgesCount} upstream funding ${uninspectedDeeperEdgesCount === 1 ? 'lineage' : 'lineages'} beyond Hop ${maxHops} were not inspected. Increase Hop Depth to scan deeper ancestors.`
      : null;

  // ==========================================================================
  // STEP 2: Unbundle Shared-Ancestor Sybil Cluster Analysis (Case 3)
  // ==========================================================================
  let sybilClusterSize = 1;
  let sybilRootFunder: string | null = null;
  const sybilSiblingSet = new Set<string>();

  for (const [visitedAddr, hopDist] of minHopByVertex.entries()) {
    if (visitedAddr === targetLower || hopDist === 0) continue;
    if (INSTITUTIONAL_WHITELIST.has(visitedAddr)) continue;

    const outEdges = outboundTransferred.get(visitedAddr) ?? [];
    const fundedRecipients = new Set<string>();
    for (const oe of outEdges) {
      fundedRecipients.add(oe.to_id.toLowerCase());
    }

    if (fundedRecipients.size >= 3) {
      for (const recipLower of fundedRecipients) {
        const seedSibling = dataset.vertices.get(recipLower);
        sybilSiblingSet.add(seedSibling?.id ?? recipLower);
      }
      const vertexObj = workingVertices.get(visitedAddr);
      if (vertexObj) {
        vertexObj.isSybilRoot = true;
        if (vertexObj.riskTag === 'INTERMEDIATE_MULE' || vertexObj.riskTag === 'CLEAN') {
          vertexObj.riskTag = 'SYBIL_ROOT_FUNDER';
        }
      }
      // Prefer the deepest discovered root funder (e.g. Sybil Mother 0xB055...9999 at Hop 2)
      const rootCandidate = workingVertices.get(visitedAddr)?.id ?? visitedAddr;
      if (!sybilRootFunder || hopDist >= 2) {
        sybilRootFunder = rootCandidate;
      }
    }

    // Check if an ancestor (like Sybil Mother at Hop 2) funded a relay at Hop 1 that funded N siblings
    const parentV = workingVertices.get(visitedAddr);
    if (parentV?.riskTag === 'SYBIL_ROOT_FUNDER' && hopDist >= 2) {
      sybilRootFunder = parentV.id;
    }
  }

  if (sybilSiblingSet.size > 1) {
    sybilClusterSize = sybilSiblingSet.size;
    // Materialize a representative sample of sibling nodes in the visual graph (up to 6 visible + cluster badge)
    const sampleSiblings = Array.from(sybilSiblingSet).slice(0, 6);
    for (const sibId of sampleSiblings) {
      const sibLower = sibId.toLowerCase();
      if (!workingVertices.has(sibLower)) {
        const seedSib = dataset.vertices.get(sibLower);
        if (seedSib) {
          workingVertices.set(sibLower, {
            ...seedSib,
            hopDistance: 1,
            isSybilSibling: true,
          });
        }
      }
      // Also attach the fan-out edge from the relay to this visible sibling
      const inboundToSib = inboundTransferred.get(sibLower) ?? [];
      for (const sibEdge of inboundToSib) {
        if (workingVertices.has(sibEdge.from_id.toLowerCase())) {
          traversedEdgesMap.set(sibEdge.id, sibEdge);
        }
      }
    }
  }

  // ==========================================================================
  // STEP 3: PoisonGraph Out-Degree Check on Target Wallet
  // ==========================================================================
  const recordedDustDegree = dataset.poisonDustDegreeByAddress.get(targetLower) ?? 0;
  const liveDustEdges = outboundDusted.get(targetLower) ?? [];
  const dustOutDegree = Math.max(recordedDustDegree, liveDustEdges.length);

  for (const dustEdge of liveDustEdges.slice(0, 5)) {
    traversedEdgesMap.set(dustEdge.id, dustEdge);
    const victimLower = dustEdge.to_id.toLowerCase();
    if (!workingVertices.has(victimLower)) {
      const victimV = dataset.vertices.get(victimLower);
      if (victimV) {
        workingVertices.set(victimLower, victimV);
      }
    }
  }

  // Add VeilPay Firewall Gate / Merchant Vault node for topological completeness
  const merchantLower = merchantCanonical.toLowerCase();
  if (!workingVertices.has(merchantLower)) {
    workingVertices.set(merchantLower, {
      id: merchantCanonical,
      v_type: 'Merchant',
      label: 'Cake Wallet Protected Vault',
      riskTag: 'MERCHANT_VAULT',
      hopDistance: -1,
      isTainted: false,
    });
  }

  // ==========================================================================
  // STEP 4: Deterministic Verdict & Gate Lock Evaluation
  // ==========================================================================
  let verdict: VerdictStatus = 'VERIFIED_CLEAN';
  let socketUnlocked = true;
  let vaultUriUnlocked = true;

  if (!policy.firewallEnabled) {
    verdict = 'ADVISORY_BYPASSED';
    socketUnlocked = true;
    vaultUriUnlocked = true;
  } else if (policy.cleanLinkEnabled && taintHits > 0) {
    verdict = 'INTERCEPTED_TAINT';
    socketUnlocked = false;
    vaultUriUnlocked = false;
  } else if (dustOutDegree >= 50) {
    verdict = 'INTERCEPTED_POISONING';
    socketUnlocked = false;
    vaultUriUnlocked = false;
  } else if (
    policy.unbundleEnabled &&
    sybilClusterSize >= policy.sybilBlockThreshold
  ) {
    verdict = 'INTERCEPTED_SYBIL';
    socketUnlocked = false;
    vaultUriUnlocked = false;
  } else if (options.isInconclusive || options.crawlTruncated) {
    verdict = 'INCONCLUSIVE';
    const isBlock = (policy.inconclusivePolicy ?? 'BLOCK') === 'BLOCK';
    socketUnlocked = !isBlock;
    vaultUriUnlocked = !isBlock;
  } else if (
    policy.unbundleEnabled &&
    (sybilClusterSize >= 3 || cyclicLoopDetected)
  ) {
    verdict = 'WARNING_SYBIL';
    socketUnlocked = true;
    vaultUriUnlocked = true;
  } else {
    verdict = 'VERIFIED_CLEAN';
    socketUnlocked = true;
    vaultUriUnlocked = true;
  }

  const allTraversedEdges = Array.from(traversedEdgesMap.values());
  // Prioritize taint path, sybil fanout, or cyclic edges in evidenceEdges; otherwise include all traversed lineage edges
  const flaggedEdges = allTraversedEdges.filter(
    (e) =>
      e.attributes.is_taint_path ||
      e.attributes.is_sybil_fanout ||
      e.attributes.is_cyclic_edge ||
      e.attributes.is_dust
  );
  const evidenceEdges =
    flaggedEdges.length > 0
      ? flaggedEdges.sort((a, b) => a.attributes.hop_distance - b.attributes.hop_distance)
      : allTraversedEdges.sort((a, b) => a.attributes.hop_distance - b.attributes.hop_distance);

  const elapsedMs = Number(
    ((options.precomputedElapsedMs ?? 0) + (performance.now() - startPerf)).toFixed(2)
  );
  const executionSource: ExecutionEngineSource =
    options.executionSource ?? 'IN_MEMORY_GSQL_ENGINE';

  const restppEnvelope: TigerGraphRestppEnvelope = {
    version: {
      edition: 'enterprise',
      api: 'v2',
      schema: 1,
    },
    error: false,
    message: '',
    results: [
      {
        verdict,
        target_wallet: targetCanonical,
        merchant_wallet: merchantCanonical,
        max_hops_queried: maxHops,
        min_taint_hop: minTaintHop,
        taint_hits: taintHits,
        sybil_cluster_size: sybilClusterSize,
        sybil_root_funder: sybilRootFunder ?? '',
        cyclic_loop_detected: cyclicLoopDetected,
        self_transfer_detected: selfTransferDetected,
        dust_out_degree: dustOutDegree,
        nodes_scanned: nodesScanned,
        edges_traversed: edgesTraversed,
        '@@evidence_edges': evidenceEdges,
      },
    ],
  };

  return {
    verdict,
    socketUnlocked,
    vaultUriUnlocked,
    targetWallet: targetCanonical,
    merchantWallet: merchantCanonical,
    maxHopsQueried: maxHops,
    policyApplied: policy,
    executionTimeMs: Math.max(0.15, elapsedMs),
    executionSource,
    minTaintHop,
    taintHits,
    taintedRootEntities,
    sybilClusterSize,
    sybilRootFunder,
    sybilSiblingWallets: Array.from(sybilSiblingSet),
    cyclicLoopDetected,
    detectedCyclePaths,
    selfTransferDetected,
    dustOutDegree,
    nodesScanned,
    edgesTraversed,
    shallowScanAdvisory,
    liveCrawlNotes: options.liveCrawlNotes ?? null,
    crawlTruncated: options.crawlTruncated,
    inconclusiveReason:
      options.inconclusiveReason ??
      (verdict === 'INCONCLUSIVE'
        ? options.crawlTruncated
          ? 'Crawl truncated before completing full ancestor lineage inspection.'
          : 'Inconclusive scan telemetry.'
        : null),
    vertices: Array.from(workingVertices.values()),
    edges: allTraversedEdges,
    evidenceEdges,
    restppEnvelope,
    gsqlQuerySnippet: buildGsqlQuerySnippet(
      targetCanonical,
      merchantCanonical,
      maxHops,
      policy.sybilBlockThreshold
    ),
    timestamp: new Date().toISOString(),
  };
}
