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

export const DEFAULT_LIVE_CRAWL_SETTINGS: LiveCrawlSettings = {
  topFundersPerVertex: 5,
  maxApiCallsPerScan: 40,
  rateLimitRps: 3,
  crawlTimeoutMs: 10000,
  maxMainnetUsdCap: Number(process.env.NEXT_PUBLIC_MAX_MAINNET_USD || 5),
};

// Etherscan V2 Free Tier supports ~90% of chains (1, 42161, 137, 59144, 5000, etc.)
// Base (8453) and Optimism (10) require Etherscan Lite+.
export const ETHERSCAN_FREE_TIER_CHAINS = new Set<number>([
  1, // Ethereum Mainnet
  42161, // Arbitrum One
  137, // Polygon
  59144, // Linea
  5000, // Mantle
  81457, // Blast
  42220, // Celo
  252, // Fraxtal
  167000, // Taiko
  146, // Sonic
  130, // Unichain
  80094, // Berachain
  143, // Monad
  11155111, // Ethereum Sepolia Testnet
  84532, // Base Sepolia Testnet
  421614, // Arbitrum Sepolia Testnet
  11155420, // OP Sepolia Testnet
  80002, // Polygon Amoy Testnet
]);

interface EtherscanTxItem {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  isError?: string;
}

const txListLruCache = new Map<string, { timestamp: number; txs: EtherscanTxItem[] }>();
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

async function fetchEtherscanInboundTransactions(params: {
  address: string;
  chainId: number;
  apiKey: string;
}): Promise<{
  txs: EtherscanTxItem[];
  usedChainId: number;
  tierFallbackNote: string | null;
  failed?: boolean;
  failureReason?: string;
}> {
  const { address, chainId, apiKey } = params;
  const targetChainId = ETHERSCAN_FREE_TIER_CHAINS.has(chainId) ? chainId : 42161;
  const tierFallbackNote = !ETHERSCAN_FREE_TIER_CHAINS.has(chainId)
    ? `Chain ${chainId} (${chainId === 8453 ? 'Base' : 'Optimism'}) requires an Etherscan Paid Plan; automatically scanned cross-chain history on Arbitrum (42161) & Ethereum (1) via Etherscan V2 Free Tier.`
    : null;

  const cacheKey = `${targetChainId}:${address.toLowerCase()}`;
  const cached = txListLruCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    return {
      txs: cached.txs,
      usedChainId: targetChainId,
      tierFallbackNote,
    };
  }

  const url = `https://api.etherscan.io/v2/api?chainid=${targetChainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${apiKey}`;
  const tokenUrl = `https://api.etherscan.io/v2/api?chainid=${targetChainId}&module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${apiKey}`;

  try {
    const [res, tokenRes] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(4000) }),
      fetch(tokenUrl, { signal: AbortSignal.timeout(4000) }).catch(() => null),
    ]);

    if (!res.ok) {
      return {
        txs: [],
        usedChainId: targetChainId,
        tierFallbackNote,
        failed: true,
        failureReason: `Etherscan API HTTP status ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      status?: string;
      message?: string;
      result?: EtherscanTxItem[] | string;
    };

    let tokenItems: EtherscanTxItem[] = [];
    if (tokenRes && tokenRes.ok) {
      try {
        const tokenData = (await tokenRes.json()) as {
          status?: string;
          result?: EtherscanTxItem[] | string;
        };
        if (Array.isArray(tokenData.result)) {
          tokenItems = tokenData.result;
        }
      } catch {
        // Non-blocking token parsing
      }
    }

    if (
      data.status === '0' &&
      typeof data.result === 'string' &&
      !data.result.toLowerCase().includes('no transactions found') &&
      tokenItems.length === 0
    ) {
      return {
        txs: [],
        usedChainId: targetChainId,
        tierFallbackNote,
        failed: true,
        failureReason: `Etherscan API error: ${data.result}`,
      };
    }

    const nativeItems = Array.isArray(data.result) ? data.result : [];
    const combined = [...nativeItems, ...tokenItems];

    if (combined.length > 0) {
      if (txListLruCache.size > 200) {
        const oldestKey = txListLruCache.keys().next().value;
        if (oldestKey) txListLruCache.delete(oldestKey);
      }
      txListLruCache.set(cacheKey, { timestamp: Date.now(), txs: combined });
      return {
        txs: combined,
        usedChainId: targetChainId,
        tierFallbackNote,
      };
    }

    // If target chain (e.g. Arbitrum) had 0 txs, fallback to Ethereum Mainnet (chainId 1)
    if (targetChainId !== 1) {
      const ethUrl = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${apiKey}`;
      const ethRes = await fetch(ethUrl, { signal: AbortSignal.timeout(4000) });
      if (ethRes.ok) {
        const ethData = (await ethRes.json()) as {
          status?: string;
          message?: string;
          result?: EtherscanTxItem[] | string;
        };
        if (
          ethData.status === '0' &&
          typeof ethData.result === 'string' &&
          !ethData.result.toLowerCase().includes('no transactions found')
        ) {
          return {
            txs: [],
            usedChainId: 1,
            tierFallbackNote,
            failed: true,
            failureReason: `Etherscan API error on ETH fallback: ${ethData.result}`,
          };
        }
        if (Array.isArray(ethData.result) && ethData.result.length > 0) {
          txListLruCache.set(`1:${address.toLowerCase()}`, {
            timestamp: Date.now(),
            txs: ethData.result,
          });
          return {
            txs: ethData.result,
            usedChainId: 1,
            tierFallbackNote,
          };
        }
      }
    }

    return { txs: [], usedChainId: targetChainId, tierFallbackNote };
  } catch (err) {
    return {
      txs: [],
      usedChainId: targetChainId,
      tierFallbackNote,
      failed: true,
      failureReason:
        err instanceof Error
          ? err.message
          : 'Etherscan API request timed out or failed',
    };
  }
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

  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) {
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
  const ethSpotPrice = spotData?.rates?.ETH && spotData.rates.ETH > 0 ? spotData.rates.ETH : 2500;

  const visitedCrawl = new Set<string>([targetLower]);
  let currentWave: string[] = [canonicalTarget];
  let apiCallsUsed = 1; // Count initial target security check
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
      apiCallsUsed += 1;

      const { txs, usedChainId, tierFallbackNote, failed, failureReason } =
        await fetchEtherscanInboundTransactions({
          address: addr,
          chainId: params.chainId,
          apiKey,
        });

      if (failed && !crawlFailed) {
        crawlFailed = true;
        crawlFailureReason = `Etherscan API query failed or timed out: ${failureReason}`;
      }

      if (tierFallbackNote && !tierNote) {
        tierNote = tierFallbackNote;
      }

      const addrLower = addr.toLowerCase();

      // Count outbound dust transfers on the target wallet (Hop 1 check)
      if (hop === 1) {
        const outboundMicroTxs = txs.filter(
          (tx) =>
            tx.from.toLowerCase() === addrLower &&
            Number(tx.value) / 1e18 <= 0.000005
        );
        if (outboundMicroTxs.length > 0) {
          poisonDustDegreeByAddress.set(addrLower, outboundMicroTxs.length);
        }
      }

      // Filter inbound non-error funding transactions (excluding zero-value dust <= 0.0001 ETH)
      const inboundTxs = txs
        .filter(
          (tx) =>
            tx.to?.toLowerCase() === addrLower &&
            tx.from &&
            tx.isError !== '1' &&
            Number(tx.value) / 1e18 > 0.0001
        )
        .sort((a, b) => Number(b.value) - Number(a.value));

      // Keep top K distinct funders per vertex
      const seenFundersForVertex = new Set<string>();
      for (const tx of inboundTxs) {
        if (seenFundersForVertex.size >= settings.topFundersPerVertex) break;
        const funderLower = tx.from.toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(funderLower)) continue;
        seenFundersForVertex.add(funderLower);

        const funderCanonical = toEip55Address(tx.from);
        const ethAmount = Number((Number(tx.value) / 1e18).toFixed(6));
        const usdEstimate = Number((ethAmount * ethSpotPrice).toFixed(2));

        apiCallsUsed += 1;
        const threatInfo = await checkGoPlusAddressSecurity(
          funderCanonical,
          usedChainId
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
            chainId: usedChainId,
            isTainted: threatInfo.isThreat,
            threatSource: threatInfo.source || 'Etherscan V2 + GoPlus Verified',
          });
        }

        edges.push({
          id: `live-${tx.hash.slice(0, 18)}-${hop}`,
          e_type: 'TRANSFERRED_TO',
          from_id: funderCanonical,
          from_type: threatInfo.isThreat ? 'ThreatEntity' : 'Wallet',
          to_id: addr,
          to_type: 'Wallet',
          attributes: {
            amount: ethAmount,
            amount_usd: usdEstimate,
            token: 'ETH',
            tx_hash: tx.hash,
            block_number: Number(tx.blockNumber) || 0,
            timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
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
    `Live Etherscan V2 + GoPlus crawl completed in ${crawlElapsedMs}ms (${apiCallsUsed} Etherscan API calls).`,
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
  });
}
