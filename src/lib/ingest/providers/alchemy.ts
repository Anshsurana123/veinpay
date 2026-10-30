import type { SpotRates } from '@/lib/rates';
import type { NormalizedTransfer, IngestCoverage, FetchTransfersOptions } from '../types';
import { computeTransferPricing } from '../pricing';
import { toEip55Address } from '@/lib/validators/address';

interface AlchemyRawTransfer {
  blockNum: string;
  hash: string;
  from: string;
  to: string;
  value: number | null;
  asset: string | null;
  category: 'external' | 'internal' | 'erc20';
  rawContract: {
    value?: string;
    address?: string;
    decimal?: string;
  };
  metadata?: {
    blockTimestamp?: string;
  };
}

const ALCHEMY_CHAIN_NETWORK_MAP: Record<number, string> = {
  1: 'eth-mainnet',
  42161: 'arb-mainnet',
  8453: 'base-mainnet',
  10: 'opt-mainnet',
  137: 'polygon-mainnet',
  59144: 'linea-mainnet',
  11155111: 'eth-sepolia',
  84532: 'base-sepolia',
  421614: 'arb-sepolia',
};

export async function fetchAlchemyTransfers(
  options: FetchTransfersOptions,
  spotRates?: Partial<SpotRates> | null
): Promise<{
  transfers: NormalizedTransfer[];
  coverage: IngestCoverage;
  failed?: boolean;
  failureReason?: string;
}> {
  const { address, chainId, apiKey, timeoutMs = 5000 } = options;
  const network = ALCHEMY_CHAIN_NETWORK_MAP[chainId] || 'arb-mainnet';
  const url = `https://${network}.g.alchemy.com/v2/${apiKey}`;

  const coverage: IngestCoverage = {
    firstFunderQueried: true,
    recentWindowQueried: true,
    internalTxQueried: true,
    tokenTxQueried: true,
    inboundComplete: true,
    truncated: false,
    totalApiCalls: 1,
    usedChainId: chainId,
    tierFallbackNote: null,
  };

  try {
    const payload = {
      id: 1,
      jsonrpc: '2.0',
      method: 'alchemy_getAssetTransfers',
      params: [
        {
          fromBlock: '0x0',
          toBlock: 'latest',
          toAddress: address,
          category: ['external', 'internal', 'erc20'],
          withMetadata: true,
          maxCount: '0x64',
          order: 'desc',
        },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Alchemy API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      result?: { transfers?: AlchemyRawTransfer[] };
      error?: { message?: string };
    };

    if (data.error) {
      throw new Error(data.error.message || 'Alchemy JSON-RPC error');
    }

    const rawTransfers = data.result?.transfers || [];
    const normalizedList: NormalizedTransfer[] = [];

    let logIndexCounter = 0;
    for (const tx of rawTransfers) {
      const fromAddr = (tx.from || '').trim().toLowerCase();
      const toAddr = (tx.to || '').trim().toLowerCase();
      if (!fromAddr || !toAddr) continue;

      const kind = tx.category === 'erc20' ? 'erc20' : tx.category === 'internal' ? 'internal' : 'native';
      const rawValStr = tx.rawContract?.value
        ? BigInt(tx.rawContract.value).toString()
        : tx.value !== null
        ? String(Math.floor(tx.value * 1e18))
        : '0';

      const pricing = computeTransferPricing({
        chainId,
        tokenKind: kind,
        rawSymbol: tx.asset,
        rawDecimals: tx.rawContract?.decimal,
        rawValueStr: rawValStr,
        spotRates,
      });

      let canonicalFrom = fromAddr;
      let canonicalTo = toAddr;
      try {
        if (/^0x[0-9a-f]{40}$/i.test(fromAddr)) canonicalFrom = toEip55Address(fromAddr);
        if (/^0x[0-9a-f]{40}$/i.test(toAddr)) canonicalTo = toEip55Address(toAddr);
      } catch {
        // Leave lowercased
      }

      normalizedList.push({
        chainId,
        txHash: tx.hash.toLowerCase(),
        logIndex: logIndexCounter++,
        from: canonicalFrom,
        to: canonicalTo,
        tokenKind: kind,
        tokenAddress: tx.rawContract?.address?.toLowerCase(),
        symbol: pricing.symbol,
        decimals: pricing.decimals,
        rawValue: BigInt(rawValStr),
        amount: pricing.amount,
        amountUsd: pricing.amountUsd,
        usdKnown: pricing.usdKnown,
        blockNumber: parseInt(tx.blockNum, 16) || 0,
        timestamp: tx.metadata?.blockTimestamp || new Date().toISOString(),
        isError: false,
        isSpam: pricing.isSpam,
      });
    }

    return {
      transfers: normalizedList,
      coverage,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    coverage.truncated = true;
    coverage.truncatedReason = errorMsg;
    coverage.inboundComplete = false;
    return {
      transfers: [],
      coverage,
      failed: true,
      failureReason: errorMsg,
    };
  }
}
