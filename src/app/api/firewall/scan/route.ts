import { NextRequest, NextResponse } from 'next/server';
import type { FirewallPolicyConfig, HopDepth, LiveCrawlSettings } from '@/types/veilpay';
import { DEFAULT_CAKE_VAULT_ADDRESSES } from '@/lib/validators/address';
import { runFullScan } from '@/lib/graph/full-scan';
import { verifyProofOfControlToken } from '@/lib/session/proof-of-control';
import {
  getVerifiedLinkPolicy,
  signScanAttestation,
} from '@/lib/security/attestation';

function parsePolicy(raw: Record<string, unknown>): FirewallPolicyConfig {
  const rawHops = Number(raw.maxHops ?? raw.max_hops ?? 3);
  const clampedHops = Math.min(5, Math.max(1, Number.isNaN(rawHops) ? 3 : rawHops)) as HopDepth;

  return {
    firewallEnabled:
      raw.firewallEnabled !== undefined
        ? raw.firewallEnabled !== 'false' && Boolean(raw.firewallEnabled)
        : raw.firewall_enabled !== undefined
          ? raw.firewall_enabled !== 'false' && Boolean(raw.firewall_enabled)
          : true,
    maxHops: clampedHops,
    cleanLinkEnabled:
      raw.cleanLinkEnabled !== undefined
        ? raw.cleanLinkEnabled !== 'false' && Boolean(raw.cleanLinkEnabled)
        : true,
    unbundleEnabled:
      raw.unbundleEnabled !== undefined
        ? raw.unbundleEnabled !== 'false' && Boolean(raw.unbundleEnabled)
        : true,
    socketAutoBridgeEnabled:
      raw.socketAutoBridgeEnabled !== undefined
        ? raw.socketAutoBridgeEnabled !== 'false' && Boolean(raw.socketAutoBridgeEnabled)
        : true,
    sybilBlockThreshold: Number(raw.sybilBlockThreshold ?? 10) || 10,
  };
}

async function handleScan(params: {
  targetWallet: string;
  merchantWallet: string;
  chainId: number;
  linkId: string;
  policy: FirewallPolicyConfig;
  crawlSettings?: Partial<LiveCrawlSettings>;
  includeGemini?: boolean;
  proofOfControlToken?: string | null;
}) {
  const { scan, receipt } = await runFullScan({
    targetWallet: params.targetWallet,
    merchantWallet: params.merchantWallet,
    chainId: params.chainId,
    policy: params.policy,
    crawlSettings: params.crawlSettings,
    includeGemini: params.includeGemini,
  });

  const pocCheck = verifyProofOfControlToken(params.proofOfControlToken, {
    scannedAddress: scan.targetWallet,
    linkId: params.linkId,
    chainId: params.chainId,
  });

  const proofOfControl = pocCheck.valid && pocCheck.payload?.proofOfControl === true;

  const scanAttestation = signScanAttestation({
    payer: scan.targetWallet,
    linkId: params.linkId,
    verdict: scan.verdict,
    socketUnlocked: scan.socketUnlocked,
    proofOfControl,
    policy: params.policy,
  });

  return NextResponse.json({
    success: true,
    scan,
    receipt,
    scanAttestation,
    proofOfControl,
  });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const targetWallet =
    sp.get('targetWallet') ||
    sp.get('target_wallet') ||
    sp.get('wallet') ||
    '0x4F2a9c117034e8B1200499A1c3f88200000188E1';
  const linkId = (sp.get('linkId') || 'default').trim();
  const verifiedLink = getVerifiedLinkPolicy(linkId);
  const merchantWallet =
    verifiedLink.vaultAddress ||
    sp.get('merchantWallet') ||
    sp.get('merchant_wallet') ||
    DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET;
  const chainId = Number(sp.get('chainId') || 42161);

  const policy = sp.has('maxHops') || sp.has('firewallEnabled')
    ? parsePolicy({
        firewallEnabled: sp.get('firewallEnabled') ?? true,
        maxHops: sp.get('maxHops') ?? sp.get('max_hops') ?? 3,
        cleanLinkEnabled: sp.get('cleanLinkEnabled') ?? true,
        unbundleEnabled: sp.get('unbundleEnabled') ?? true,
        sybilBlockThreshold: sp.get('sybilBlockThreshold') ?? 10,
      })
    : verifiedLink.policy;

  return handleScan({
    targetWallet,
    merchantWallet,
    chainId,
    linkId,
    policy,
    includeGemini: sp.get('includeGemini') === 'true',
    proofOfControlToken: sp.get('proofOfControlToken'),
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
    const linkId = String(body.linkId ?? 'default').trim() || 'default';
    const verifiedLink = getVerifiedLinkPolicy(linkId);
    const merchantWallet = String(
      verifiedLink.vaultAddress ??
        body.merchantWallet ??
        body.merchant_wallet ??
        DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET
    );
    const chainId = Number(body.chainId ?? 42161);
    const rawPolicy =
      body.policy && typeof body.policy === 'object'
        ? (body.policy as Record<string, unknown>)
        : null;
    const policy = rawPolicy ? parsePolicy(rawPolicy) : verifiedLink.policy;
    const crawlSettings =
      body.crawlSettings && typeof body.crawlSettings === 'object'
        ? (body.crawlSettings as Partial<LiveCrawlSettings>)
        : undefined;
    const proofOfControlToken =
      typeof body.proofOfControlToken === 'string'
        ? body.proofOfControlToken
        : null;

    return handleScan({
      targetWallet,
      merchantWallet,
      chainId,
      linkId,
      policy,
      crawlSettings,
      includeGemini: Boolean(body.includeGemini),
      proofOfControlToken,
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
