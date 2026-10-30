import type {
  AigiForensicReceipt,
  FirewallPolicyConfig,
  FirewallScanResult,
  LiveCrawlSettings,
} from '@/types/veinpay';
import {
  resolveCanonicalWalletInput,
  runVeinPayFirewallTraversal,
} from '@/lib/graph/engine';
import { tryExecuteLiveTigerGraphQuery } from '@/lib/graph/tigergraph-client';
import { crawlLiveAddressAndScan } from '@/lib/graph/live-crawler';
import { buildSeededGraphDataset } from '@/lib/graph/seed-topologies';
import {
  generateAigiForensicReceipt,
  maybeEnrichReceiptWithGemini,
} from '@/lib/aigi/verdict';
import { computePolicyKeccak256 } from '@/lib/links/canonical';
import {
  buildScanCacheKey,
  clampCrawlSettings,
  getCachedScanResult,
  setCachedScanResult,
} from '@/lib/security/scan-cache';

export const AUTHORITATIVE_DEFAULT_POLICY: FirewallPolicyConfig = {
  firewallEnabled: true,
  maxHops: 3,
  cleanLinkEnabled: true,
  unbundleEnabled: true,
  socketAutoBridgeEnabled: true,
  sybilBlockThreshold: 10,
  inconclusivePolicy: 'BLOCK',
};

export interface RunFullScanParams {
  targetWallet: string;
  merchantWallet: string;
  chainId: number;
  policy: FirewallPolicyConfig;
  crawlSettings?: Partial<LiveCrawlSettings>;
  includeGemini?: boolean;
  linkId?: string;
  graphSnapshot?: string;
  receiptNonce?: string;
}

export interface RunFullScanResult {
  scan: FirewallScanResult;
  receipt: AigiForensicReceipt;
}

/**
 * Shared authoritative server-side firewall traversal pipeline used by
 * `/api/firewall/scan`, `/api/socket/quote`, and `/api/cctp/quote`.
 *
 * Execution order:
 * 1. Live TigerGraph 4.x RESTPP (`tryExecuteLiveTigerGraphQuery`) if configured
 * 2. Seeded topological dataset (`runVeinPayFirewallTraversal`) if vertex is seeded
 * 3. Live Etherscan V2 + GoPlus + threat-intel crawl (`crawlLiveAddressAndScan`)
 *
 * CACHE ISOLATION RULE (P1-2):
 * We cache ONLY the graph scan result (targetWallet, chainId, policyHash).
 * Receipts are regenerated and signed per request for the specific linkId,
 * merchantWallet, and timestamps so different links never receive mixed merchant data!
 */
export async function runFullScan(
  params: RunFullScanParams
): Promise<RunFullScanResult> {
  const canonicalTarget = resolveCanonicalWalletInput(params.targetWallet);
  const canonicalMerchant = resolveCanonicalWalletInput(params.merchantWallet);

  // Clamp crawl settings server-side to hard maxima (env-configurable)
  const clampedCrawlSettings = clampCrawlSettings(params.crawlSettings);

  // Check cache by (targetWallet, chainId, policyHash)
  const policyHash = computePolicyKeccak256(params.policy);
  const cacheKey = buildScanCacheKey(
    canonicalTarget,
    params.chainId,
    policyHash
  );

  const cachedScan = getCachedScanResult(cacheKey);
  if (cachedScan) {
    const isolatedScan: FirewallScanResult = {
      ...cachedScan,
      merchantWallet: canonicalMerchant,
    };
    let receipt = generateAigiForensicReceipt(isolatedScan, {
      linkId: params.linkId,
      payer: canonicalTarget,
      merchant: canonicalMerchant,
      policyHash,
      graphSnapshot: params.graphSnapshot,
      receiptNonce: params.receiptNonce,
    });
    if (params.includeGemini && !receipt.geminiExecutiveSummary) {
      receipt = await maybeEnrichReceiptWithGemini(receipt);
    }
    return {
      scan: isolatedScan,
      receipt,
    };
  }

  // 1. Try live TigerGraph 4.x RESTPP if configured
  const liveTgResult = await tryExecuteLiveTigerGraphQuery({
    targetWallet: canonicalTarget,
    merchantWallet: canonicalMerchant,
    policy: params.policy,
  });

  if (liveTgResult) {
    const ttlMs = liveTgResult.verdict === 'INCONCLUSIVE' ? 8_000 : 60_000;
    setCachedScanResult(cacheKey, liveTgResult, ttlMs);

    let receipt = generateAigiForensicReceipt(liveTgResult, {
      linkId: params.linkId,
      payer: canonicalTarget,
      merchant: canonicalMerchant,
      policyHash,
      graphSnapshot: params.graphSnapshot,
      receiptNonce: params.receiptNonce,
    });
    if (params.includeGemini) {
      receipt = await maybeEnrichReceiptWithGemini(receipt);
    }
    return {
      scan: liveTgResult,
      receipt,
    };
  }

  // 2. Check if target wallet is in the seeded graph dataset
  const seeded = buildSeededGraphDataset();
  const isSeeded = seeded.vertices.has(canonicalTarget.toLowerCase());

  const scanResult = isSeeded
    ? runVeinPayFirewallTraversal({
        targetWallet: canonicalTarget,
        merchantWallet: canonicalMerchant,
        policy: params.policy,
        customDataset: seeded,
        executionSource: 'IN_MEMORY_GSQL_ENGINE',
      })
    : await crawlLiveAddressAndScan({
        targetWallet: canonicalTarget,
        merchantWallet: canonicalMerchant,
        chainId: params.chainId,
        policy: params.policy,
        crawlSettings: clampedCrawlSettings,
      });

  const ttlMs = scanResult.verdict === 'INCONCLUSIVE' ? 8_000 : 60_000;
  setCachedScanResult(cacheKey, scanResult, ttlMs);

  let receipt = generateAigiForensicReceipt(scanResult, {
    linkId: params.linkId,
    payer: canonicalTarget,
    merchant: canonicalMerchant,
    policyHash,
    graphSnapshot: params.graphSnapshot,
    receiptNonce: params.receiptNonce,
  });
  if (params.includeGemini) {
    receipt = await maybeEnrichReceiptWithGemini(receipt);
  }

  return {
    scan: scanResult,
    receipt,
  };
}
