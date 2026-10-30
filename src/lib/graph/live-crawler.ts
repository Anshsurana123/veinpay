import type {
  FirewallPolicyConfig,
  FirewallScanResult,
  GraphEdge,
  GraphVertex,
  LiveCrawlSettings,
  RiskCategory,
} from '@/types/veilpay';
import threatSnapshot from '@/data/threat-intel-snapshot.json';
import { toEip55Address } from '@/lib/validators/address';
import {
  buildSeededGraphDataset,
  type SeedGraphDataset,
} from '@/lib/graph/seed-topologies';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';
import { checkGoPlusAddress } from '@/lib/security/goplus';
import { getLiveSpotRates } from '@/lib/rates';
import { upsertGraphToTigerGraph } from '@/lib/graph/tigergraph-client';
import {
  fetchEtherscanTransfers,
  fetchAlchemyTransfers,
  ETHERSCAN_FREE_TIER_CHAINS,
} from '@/lib/ingest';
import type { NormalizedTransfer, IngestCoverage } from '@/lib/ingest';

export const DEFAULT_LIVE_CRAWL_SETTINGS: LiveCrawlSettings = {
  topFundersPerVertex: 5,
  maxApiCallsPerScan: 40,
  rateLimitRps: 3,
  crawlTimeoutMs: 10000,
  maxMainnetUsdCap: Number(process.env.NEXT_PUBLIC_MAX_MAINNET_USD || 5),
};

export { ETHERSCAN_FREE_TIER_CHAINS };

const goPlusLruCache = new Map<
  string,
  {
    isThreat: boolean;
    riskCategory: RiskCategory;
    label: string;
    source: string;
  }
>();

const SNAPSHOT_THREAT_LOOKUP = new Map(
  threatSnapshot.entities.map((e) => [e.address.toLowerCase(), e])
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkGoPlusAddressSecurity(
  address: string,
  chainId: number
): Promise<{
  isThreat: boolean;
  riskCategory: RiskCategory;
  label: string;
  source: string;
  failed?: boolean;
  failureReason?: string;
}> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const cached = goPlusLruCache.get(key);
  if (cached) return cached;

  // Check local bundled ScamSniffer / OFAC snapshot first (O(1))
  const snapHit = SNAPSHOT_THREAT_LOOKUP.get(address.toLowerCase());
  if (snapHit) {
    const res = {
      isThreat: true,
      riskCategory: snapHit.riskCategory as RiskCategory,
      label: snapHit.label,
      source: snapHit.source,
    };
    goPlusLruCache.set(key, res);
    return res;
  }

  const liveVerdict = await checkGoPlusAddress(address, chainId, 2500);
  if (liveVerdict.failed) {
    return {
      isThreat: false,
      riskCategory: 'CLEAN',
      label: '',
      source: '',
      failed: true,
      failureReason: liveVerdict.failureReason || 'GoPlus API request failed or timed out',
    };
  }

  const res = {
    isThreat: liveVerdict.isThreat,
    riskCategory: liveVerdict.riskCategory,
    label: liveVerdict.label,
    source: liveVerdict.source,
  };
  goPlusLruCache.set(key, res);
  return res;
}

export async function crawlLiveAddressAndScan(params: {
  targetWallet: string;
  merchantWallet: string;
  chainId: number;
  policy: FirewallPolicyConfig;
  crawlSettings?: Partial<LiveCrawlSettings>;
}): Promise<FirewallScanResult> {
  const startPerf = performance.now();
  const seededDataset = buildSeededGraphDataset();
  const targetLower = params.targetWallet.trim().toLowerCase();

  // If the wallet is already in the seeded TigerGraph dataset, run immediately in <2ms
  if (seededDataset.vertices.has(targetLower)) {
    return runVeilPayFirewallTraversal({
      targetWallet: params.targetWallet,
      merchantWallet: params.merchantWallet,
      policy: params.policy,
      customDataset: seededDataset,
      executionSource: 'IN_MEMORY_GSQL_ENGINE',
    });
  }

  const etherscanKey = process.env.ETHERSCAN_API_KEY?.trim();
  const alchemyKey = process.env.ALCHEMY_API_KEY?.trim();

  if (!etherscanKey && !alchemyKey) {
    const reason =
      'Custom address not found in seeded graph and ETHERSCAN_API_KEY is unset; unable to index upstream funding lineage.';
    return runVeilPayFirewallTraversal({
      targetWallet: params.targetWallet,
      merchantWallet: params.merchantWallet,
      policy: params.policy,
      customDataset: seededDataset,
      executionSource: 'IN_MEMORY_GSQL_ENGINE',
      liveCrawlNotes: reason,
      isInconclusive: true,
      inconclusiveReason: reason,
    });
  }

  const settings: LiveCrawlSettings = {
    ...DEFAULT_LIVE_CRAWL_SETTINGS,
    ...(params.crawlSettings ?? {}),
  };

  const vertices = new Map<string, GraphVertex>(seededDataset.vertices);
  const edges: GraphEdge[] = [...seededDataset.edges];
  const poisonDustDegreeByAddress = new Map<string, number>(
    seededDataset.poisonDustDegreeByAddress
  );

  const canonicalTarget = /^0x[0-9a-fA-F]{40}$/.test(params.targetWallet.trim())
    ? toEip55Address(params.targetWallet.trim())
    : params.targetWallet.trim();

  const targetSecurity = await checkGoPlusAddressSecurity(
    canonicalTarget,
    params.chainId
  );

  let crawlFailed = false;
  let crawlFailureReason: string | null = null;
  if (targetSecurity.failed) {
    crawlFailed = true;
    crawlFailureReason = `GoPlus security check failed or timed out: ${targetSecurity.failureReason}`;
  }

  vertices.set(targetLower, {
    id: canonicalTarget,
    v_type: targetSecurity.isThreat ? 'ThreatEntity' : 'Wallet',
    label:
      targetSecurity.label ||
      `Live Wallet (${canonicalTarget.slice(0, 6)}...${canonicalTarget.slice(-4)})`,
    riskTag: targetSecurity.isThreat ? targetSecurity.riskCategory : 'PAYER_TARGET',
    hopDistance: 0,
    chainId: params.chainId,
    isTainted: targetSecurity.isThreat,
    threatSource: targetSecurity.source || undefined,
  });

  const spotData = await getLiveSpotRates().catch(() => null);

  const visitedCrawl = new Set<string>([targetLower]);
  let currentWave: string[] = [canonicalTarget];
  let apiCallsUsed = 1; // Initial target security check
  let crawlTruncated = false;
  let tierNote: string | null = null;
  const minIntervalMs = Math.ceil(1000 / Math.max(1, settings.rateLimitRps));

  for (let hop = 1; hop <= params.policy.maxHops; hop++) {
    if (currentWave.length === 0) break;
    if (
      apiCallsUsed >= settings.maxApiCallsPerScan ||
      performance.now() - startPerf > settings.crawlTimeoutMs
    ) {
      crawlTruncated = true;
      break;
    }

    const nextWave: string[] = [];

    for (const addr of currentWave) {
      if (
        apiCallsUsed >= settings.maxApiCallsPerScan ||
        performance.now() - startPerf > settings.crawlTimeoutMs
      ) {
        crawlTruncated = true;
        break;
      }

      if (apiCallsUsed > 0) {
        await sleep(minIntervalMs);
      }

      let fetchRes: {
        transfers: NormalizedTransfer[];
        coverage: IngestCoverage;
        failed?: boolean;
        failureReason?: string;
      };

      if (etherscanKey) {
        fetchRes = await fetchEtherscanTransfers(
          {
            address: addr,
            chainId: params.chainId,
            apiKey: etherscanKey,
            timeoutMs: 4000,
          },
          spotData?.rates
        );
      } else {
        fetchRes = await fetchAlchemyTransfers(
          {
            address: addr,
            chainId: params.chainId,
            apiKey: alchemyKey!,
            timeoutMs: 4000,
          },
          spotData?.rates
        );
      }

      apiCallsUsed += fetchRes.coverage.totalApiCalls;

      if (fetchRes.failed && !crawlFailed) {
        crawlFailed = true;
        crawlFailureReason = `Ingest API query failed or timed out: ${fetchRes.failureReason}`;
      }

      if (fetchRes.coverage.tierFallbackNote && !tierNote) {
        tierNote = fetchRes.coverage.tierFallbackNote;
      }

      const addrLower = addr.toLowerCase();
      const transfers = fetchRes.transfers;

      // 1. Detect outbound dust/spam transfers on target wallet (Hop 1 check)
      if (hop === 1) {
        const outboundDustTxs = transfers.filter(
          (tx) =>
            tx.from.toLowerCase() === addrLower &&
            (tx.isSpam || (tx.amountUsd !== null && tx.amountUsd <= 0.005))
        );
        if (outboundDustTxs.length > 0) {
          poisonDustDegreeByAddress.set(addrLower, outboundDustTxs.length);
        }
      }

      // 2. Filter inbound funding transactions
      const inboundTransfers = transfers
        .filter((tx) => {
          if (tx.to.toLowerCase() !== addrLower) return false;
          if (tx.isError) return false;
          // Zero-value spam goes to dust, not funding lineage
          if (tx.isSpam) return false;
          // Unpriced transfers are NOT treated as dust - taint propagates conservatively
          if (!tx.usdKnown) return true;
          // Priced transfers: exclude micro-dust <= 0.0001 amount or <= $0.005
          if (tx.amountUsd !== null && tx.amountUsd < 0.005 && tx.amount <= 0.0001) return false;
          return true;
        })
        .sort((a, b) => {
          const valA = a.amountUsd ?? a.amount;
          const valB = b.amountUsd ?? b.amount;
          return valB - valA;
        });

      // Keep top K distinct funders per vertex
      const seenFundersForVertex = new Set<string>();
      for (const tx of inboundTransfers) {
        if (seenFundersForVertex.size >= settings.topFundersPerVertex) break;
        const funderLower = tx.from.toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(funderLower)) continue;
        seenFundersForVertex.add(funderLower);

        const funderCanonical = toEip55Address(tx.from);
        apiCallsUsed += 1;
        const threatInfo = await checkGoPlusAddressSecurity(
          funderCanonical,
          fetchRes.coverage.usedChainId
        );

        if (threatInfo.failed && !crawlFailed) {
          crawlFailed = true;
          crawlFailureReason = `GoPlus security check on ancestor failed or timed out: ${threatInfo.failureReason}`;
        }

        if (!vertices.has(funderLower)) {
          vertices.set(funderLower, {
            id: funderCanonical,
            v_type: threatInfo.isThreat ? 'ThreatEntity' : 'Wallet',
            label:
              threatInfo.label ||
              `On-Chain Ancestor (${funderCanonical.slice(0, 6)}...${funderCanonical.slice(-4)})`,
            riskTag: threatInfo.isThreat
              ? threatInfo.riskCategory
              : 'INTERMEDIATE_MULE',
            hopDistance: hop,
            chainId: fetchRes.coverage.usedChainId,
            isTainted: threatInfo.isThreat,
            threatSource: threatInfo.source || 'Etherscan V2 + GoPlus Verified',
          });
        }

        edges.push({
          id: `live-${tx.txHash.slice(0, 18)}-${tx.logIndex}-${hop}`,
          e_type: 'TRANSFERRED_TO',
          from_id: funderCanonical,
          from_type: threatInfo.isThreat ? 'ThreatEntity' : 'Wallet',
          to_id: addr,
          to_type: 'Wallet',
          attributes: {
            amount: tx.amount,
            amount_usd: tx.amountUsd ?? 0,
            token: tx.symbol,
            tx_hash: tx.txHash,
            block_number: tx.blockNumber,
            timestamp: tx.timestamp,
            hop_distance: hop,
            is_taint_path: threatInfo.isThreat,
          },
        });

        if (!visitedCrawl.has(funderLower)) {
          visitedCrawl.add(funderLower);
          nextWave.push(funderCanonical);
        }
      }
    }

    currentWave = nextWave;
  }

  const crawlElapsedMs = Number((performance.now() - startPerf).toFixed(2));
  const summaryNoteParts: string[] = [
    `Live Etherscan V2 + GoPlus crawl completed in ${crawlElapsedMs}ms (${apiCallsUsed} API calls).`,
  ];
  if (tierNote) summaryNoteParts.push(tierNote);
  if (crawlTruncated) {
    summaryNoteParts.push(
      `TRUNCATED: Reached crawl safety budget (${settings.maxApiCallsPerScan} calls / ${settings.crawlTimeoutMs}ms).`
    );
    if (!crawlFailureReason) {
      crawlFailureReason = `Crawl truncated: reached maximum API query or execution timeout budget (${settings.maxApiCallsPerScan} calls / ${settings.crawlTimeoutMs}ms).`;
    }
  }

  const customDataset: SeedGraphDataset = {
    vertices,
    edges,
    poisonDustDegreeByAddress,
  };

  if (process.env.TIGERGRAPH_HOST) {
    try {
      await upsertGraphToTigerGraph({ vertices, edges });
    } catch {
      // Non-blocking upsert error
    }
  }

  const isInconclusive = crawlTruncated || crawlFailed;

  return runVeilPayFirewallTraversal({
    targetWallet: canonicalTarget,
    merchantWallet: params.merchantWallet,
    policy: params.policy,
    customDataset,
    executionSource: 'ETHERSCAN_V2_LIVE_CRAWL',
    liveCrawlNotes: summaryNoteParts.join(' '),
    crawlTruncated,
    isInconclusive,
    inconclusiveReason: crawlFailureReason,
    precomputedElapsedMs: crawlElapsedMs,
    coverage: {
      etherscanQueried: Boolean(etherscanKey),
      etherscanInboundComplete: !crawlTruncated && !crawlFailed,
      goplusQueried: true,
      snapshotQueried: true,
      truncatedReason: crawlFailureReason ?? undefined,
    },
  });
}
