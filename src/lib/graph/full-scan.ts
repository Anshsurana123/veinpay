import type {
  AigiForensicReceipt,
  FirewallPolicyConfig,
  FirewallScanResult,
  LiveCrawlSettings,
} from '@/types/veilpay';
import {
  resolveCanonicalWalletInput,
  runVeilPayFirewallTraversal,
} from '@/lib/graph/engine';
import { tryExecuteLiveTigerGraphQuery } from '@/lib/graph/tigergraph-client';
import { crawlLiveAddressAndScan } from '@/lib/graph/live-crawler';
import { buildSeededGraphDataset } from '@/lib/graph/seed-topologies';
import {
  generateAigiForensicReceipt,
  maybeEnrichReceiptWithGemini,
} from '@/lib/aigi/verdict';

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
 * 2. Seeded topological dataset (`runVeilPayFirewallTraversal`) if vertex is seeded
 * 3. Live Etherscan V2 + GoPlus + threat-intel crawl (`crawlLiveAddressAndScan`)
 */
export async function runFullScan(
  params: RunFullScanParams
): Promise<RunFullScanResult> {
  const canonicalTarget = resolveCanonicalWalletInput(params.targetWallet);
  const canonicalMerchant = resolveCanonicalWalletInput(params.merchantWallet);

  // 1. Try live TigerGraph 4.x RESTPP if configured
  const liveTgResult = await tryExecuteLiveTigerGraphQuery({
    targetWallet: canonicalTarget,
    merchantWallet: canonicalMerchant,
    policy: params.policy,
  });

  if (liveTgResult) {
    let receipt = generateAigiForensicReceipt(liveTgResult);
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
    ? runVeilPayFirewallTraversal({
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
        crawlSettings: params.crawlSettings,
      });

  let receipt = generateAigiForensicReceipt(scanResult);
  if (params.includeGemini) {
    receipt = await maybeEnrichReceiptWithGemini(receipt);
  }

  return {
    scan: scanResult,
    receipt,
  };
}
