import type { SpotRates } from '@/lib/rates';
import type { NormalizedTransfer, IngestCoverage, FetchTransfersOptions } from '../types';
import { computeTransferPricing } from '../pricing';
import { toEip55Address } from '@/lib/validators/address';

// Etherscan V2 Free Tier supported chains
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

interface RawEtherscanTx {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  contractAddress?: string;
  isError?: string;
  traceId?: string;
}

interface EtherscanApiResponse {
  status: string;
  message: string;
  result: RawEtherscanTx[] | string;
}

// Strategy-aware LRU cache to prevent caching partial fetches under global keys
const transferCache = new Map<string, { timestamp: number; transfers: NormalizedTransfer[]; coverage: IngestCoverage }>();

function buildCacheKey(chainId: number, address: string, strategies: string[]): string {
  return `${chainId}:${address.toLowerCase()}:${[...strategies].sort().join('+')}`;
}

export function clearEtherscanIngestCacheForTests(): void {
  transferCache.clear();
}

export async function fetchEtherscanTransfers(
  options: FetchTransfersOptions,
  spotRates?: Partial<SpotRates> | null
): Promise<{
  transfers: NormalizedTransfer[];
  coverage: IngestCoverage;
  failed?: boolean;
  failureReason?: string;
}> {
  const {
    address,
    chainId,
    apiKey,
    timeoutMs = 5000,
  } = options;

  const targetChainId = ETHERSCAN_FREE_TIER_CHAINS.has(chainId) ? chainId : 42161;
  const tierFallbackNote = !ETHERSCAN_FREE_TIER_CHAINS.has(chainId)
    ? `Chain ${chainId} (${chainId === 8453 ? 'Base' : 'Optimism'}) requires an Etherscan Paid Plan; automatically scanned cross-chain history on Arbitrum (42161) & Ethereum (1) via Etherscan V2 Free Tier.`
    : null;

  const requestedStrategies: string[] = [];
  if (options.includeFirstFunder !== false) requestedStrategies.push('firstFunder');
  if (options.includeRecentWindow !== false) requestedStrategies.push('recentWindow');
  if (options.includeInternalTxs !== false) requestedStrategies.push('internalTx');
  if (options.includeTokenTxs !== false) requestedStrategies.push('tokenTx');

  const cacheKey = buildCacheKey(targetChainId, address, requestedStrategies);
  const cached = transferCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    return {
      transfers: cached.transfers,
      coverage: cached.coverage,
    };
  }

  let totalApiCalls = 0;
  const baseUrl = `https://api.etherscan.io/v2/api?chainid=${targetChainId}`;

  async function fetchEndpoint(url: string): Promise<RawEtherscanTx[]> {
    totalApiCalls += 1;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as EtherscanApiResponse;
    if (data.status === '0') {
      const msg = typeof data.result === 'string' ? data.result : data.message;
      if (msg.toLowerCase().includes('no transactions found')) {
        return [];
      }
      throw new Error(msg || 'Etherscan API returned status 0');
    }
    return Array.isArray(data.result) ? data.result : [];
  }

  const coverage: IngestCoverage = {
    firstFunderQueried: false,
    recentWindowQueried: false,
    internalTxQueried: false,
    tokenTxQueried: false,
    inboundComplete: true,
    truncated: false,
    totalApiCalls: 0,
    usedChainId: targetChainId,
    tierFallbackNote,
  };

  const rawTransfers: Array<{
    tx: RawEtherscanTx;
    kind: 'native' | 'erc20' | 'internal';
    logIndex: number;
  }> = [];

  try {
    // 1. Strategy A: First Inbound Funder (sort=asc limit 5)
    if (options.includeFirstFunder !== false) {
      const firstFunderUrl = `${baseUrl}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=5&sort=asc&apikey=${apiKey}`;
      const firstTxs = await fetchEndpoint(firstFunderUrl);
      coverage.firstFunderQueried = true;
      for (const tx of firstTxs) {
        rawTransfers.push({ tx, kind: 'native', logIndex: 0 });
      }
    }

    // 2. Strategy B: Paginated Recent Window (sort=desc limit 100)
    if (options.includeRecentWindow !== false) {
      const recentUrl = `${baseUrl}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${apiKey}`;
      const recentTxs = await fetchEndpoint(recentUrl);
      coverage.recentWindowQueried = true;
      for (const tx of recentTxs) {
        rawTransfers.push({ tx, kind: 'native', logIndex: 0 });
      }
    }

    // 3. Strategy C: Internal Transactions (action=txlistinternal sort=desc limit 50)
    if (options.includeInternalTxs !== false) {
      try {
        const internalUrl = `${baseUrl}&module=account&action=txlistinternal&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${apiKey}`;
        const internalTxs = await fetchEndpoint(internalUrl);
        coverage.internalTxQueried = true;
        for (const tx of internalTxs) {
          rawTransfers.push({ tx, kind: 'internal', logIndex: 0 });
        }
      } catch {
        // Internal txs can occasionally be unsupported on testnets or specific chains; flag incomplete
        coverage.internalTxQueried = false;
      }
    }

    // 4. Strategy D: Token Transfers (action=tokentx sort=desc limit 50)
    if (options.includeTokenTxs !== false) {
      try {
        const tokenUrl = `${baseUrl}&module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${apiKey}`;
        const tokenTxs = await fetchEndpoint(tokenUrl);
        coverage.tokenTxQueried = true;
        let lIndex = 1;
        for (const tx of tokenTxs) {
          rawTransfers.push({ tx, kind: 'erc20', logIndex: lIndex++ });
        }
      } catch {
        coverage.tokenTxQueried = false;
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    coverage.truncated = true;
    coverage.truncatedReason = errorMsg;
    coverage.inboundComplete = false;
    coverage.totalApiCalls = totalApiCalls;

    return {
      transfers: [],
      coverage,
      failed: true,
      failureReason: errorMsg,
    };
  }

  coverage.totalApiCalls = totalApiCalls;

  // Deduplicate transfers by unique key: txHash:logIndex:from:to:tokenKind
  const seenTxKeys = new Set<string>();
  const normalizedList: NormalizedTransfer[] = [];

  for (const item of rawTransfers) {
    const { tx, kind, logIndex } = item;
    const fromAddr = (tx.from || '').trim().toLowerCase();
    const toAddr = (tx.to || '').trim().toLowerCase();

    if (!fromAddr || !toAddr) continue;

    const dedupKey = `${tx.hash.toLowerCase()}:${logIndex}:${fromAddr}:${toAddr}:${kind}`;
    if (seenTxKeys.has(dedupKey)) continue;
    seenTxKeys.add(dedupKey);

    const pricing = computeTransferPricing({
      chainId: targetChainId,
      tokenKind: kind,
      rawSymbol: tx.tokenSymbol,
      rawDecimals: tx.tokenDecimal,
      rawValueStr: tx.value || '0',
      spotRates,
    });

    const isError = tx.isError === '1';

    let canonicalFrom = fromAddr;
    let canonicalTo = toAddr;
    try {
      if (/^0x[0-9a-f]{40}$/i.test(fromAddr)) canonicalFrom = toEip55Address(fromAddr);
      if (/^0x[0-9a-f]{40}$/i.test(toAddr)) canonicalTo = toEip55Address(toAddr);
    } catch {
      // Leave lowercased if not strictly an EVM address
    }

    normalizedList.push({
      chainId: targetChainId,
      txHash: tx.hash.toLowerCase(),
      logIndex,
      from: canonicalFrom,
      to: canonicalTo,
      tokenKind: kind,
      tokenAddress: tx.contractAddress ? tx.contractAddress.toLowerCase() : undefined,
      symbol: pricing.symbol,
      decimals: pricing.decimals,
      rawValue: BigInt(tx.value || '0'),
      amount: pricing.amount,
      amountUsd: pricing.amountUsd,
      usdKnown: pricing.usdKnown,
      blockNumber: Number(tx.blockNumber) || 0,
      timestamp: new Date((Number(tx.timeStamp) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      isError,
      isSpam: pricing.isSpam,
    });
  }

  // Cache result if not truncated
  if (!coverage.truncated && normalizedList.length > 0) {
    if (transferCache.size > 200) {
      const oldest = transferCache.keys().next().value;
      if (oldest) transferCache.delete(oldest);
    }
    transferCache.set(cacheKey, {
      timestamp: Date.now(),
      transfers: normalizedList,
      coverage,
    });
  }

  return {
    transfers: normalizedList,
    coverage,
  };
}
