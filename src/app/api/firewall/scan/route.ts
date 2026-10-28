import { NextRequest, NextResponse } from 'next/server';
import type { FirewallPolicyConfig, HopDepth, LiveCrawlSettings } from '@/types/veilpay';
import { DEFAULT_CAKE_VAULT_ADDRESSES } from '@/lib/validators/address';
import { resolveCanonicalWalletInput, runVeilPayFirewallTraversal } from '@/lib/graph/engine';
import { tryExecuteLiveTigerGraphQuery } from '@/lib/graph/tigergraph-client';
import { crawlLiveAddressAndScan } from '@/lib/graph/live-crawler';
import { buildSeededGraphDataset } from '@/lib/graph/seed-topologies';
import {
  generateAigiForensicReceipt,
  maybeEnrichReceiptWithGemini,
} from '@/lib/aigi/verdict';

function parsePolicy(raw: Record<string, unknown>): FirewallPolicyConfig {
  const rawHops = Number(raw.maxHops ?? raw.max_hops ?? 3);
  const clampedHops = Math.min(5, Math.max(1, Number.isNaN(rawHops) ? 3 : rawHops)) as HopDepth;

  return {
    firewallEnabled:
      raw.firewallEnabled !== undefined
        ? Boolean(raw.firewallEnabled)
        : raw.firewall_enabled !== undefined
          ? Boolean(raw.firewall_enabled)
          : true,
    maxHops: clampedHops,
    cleanLinkEnabled:
      raw.cleanLinkEnabled !== undefined ? Boolean(raw.cleanLinkEnabled) : true,
    unbundleEnabled:
      raw.unbundleEnabled !== undefined ? Boolean(raw.unbundleEnabled) : true,
    socketAutoBridgeEnabled:
      raw.socketAutoBridgeEnabled !== undefined
        ? Boolean(raw.socketAutoBridgeEnabled)
        : true,
    sybilBlockThreshold: Number(raw.sybilBlockThreshold ?? 10) || 10,
  };
}

async function handleScan(params: {
  targetWallet: string;
  merchantWallet: string;
  chainId: number;
  policy: FirewallPolicyConfig;
  crawlSettings?: Partial<LiveCrawlSettings>;
  includeGemini?: boolean;
}) {
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
    return NextResponse.json({
      success: true,
      scan: liveTgResult,
      receipt,
    });
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

  return NextResponse.json({
    success: true,
    scan: scanResult,
    receipt,
  });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const targetWallet =
    sp.get('targetWallet') ||
    sp.get('target_wallet') ||
    sp.get('wallet') ||
    '0x4F2a9c117034e8B1200499A1c3f88200000188E1';
  const merchantWallet =
    sp.get('merchantWallet') ||
    sp.get('merchant_wallet') ||
    DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET;
  const chainId = Number(sp.get('chainId') || 42161);

  const policy = parsePolicy({
    firewallEnabled:
      sp.get('firewallEnabled') !== null
        ? sp.get('firewallEnabled') !== 'false'
        : true,
    maxHops: sp.get('maxHops') ?? sp.get('max_hops') ?? 3,
    cleanLinkEnabled:
      sp.get('cleanLinkEnabled') !== null
        ? sp.get('cleanLinkEnabled') !== 'false'
        : true,
    unbundleEnabled:
      sp.get('unbundleEnabled') !== null
        ? sp.get('unbundleEnabled') !== 'false'
        : true,
    sybilBlockThreshold: sp.get('sybilBlockThreshold') ?? 10,
  });

  return handleScan({
    targetWallet,
    merchantWallet,
    chainId,
    policy,
    includeGemini: sp.get('includeGemini') === 'true',
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const targetWallet = String(
      body.targetWallet ??
        body.target_wallet ??
        body.wallet ??
        '0x4F2a9c117034e8B1200499A1c3f88200000188E1'
    );
    const merchantWallet = String(
      body.merchantWallet ??
        body.merchant_wallet ??
        DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET
    );
    const chainId = Number(body.chainId ?? 42161);
    const rawPolicy =
      body.policy && typeof body.policy === 'object'
        ? (body.policy as Record<string, unknown>)
        : body;
    const policy = parsePolicy(rawPolicy);
    const crawlSettings =
      body.crawlSettings && typeof body.crawlSettings === 'object'
        ? (body.crawlSettings as Partial<LiveCrawlSettings>)
        : undefined;

    return handleScan({
      targetWallet,
      merchantWallet,
      chainId,
      policy,
      crawlSettings,
      includeGemini: Boolean(body.includeGemini),
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Invalid request payload',
      },
      { status: 400 }
    );
  }
}
