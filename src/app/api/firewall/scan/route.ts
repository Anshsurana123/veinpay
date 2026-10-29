import { NextRequest, NextResponse } from 'next/server';
import type { LiveCrawlSettings } from '@/types/veilpay';
import { runFullScan } from '@/lib/graph/full-scan';
import { resolveVerifiedLinkAuthority } from '@/lib/links';
import { verifyProofOfControlToken } from '@/lib/session/proof-of-control';
import { signScanAttestation } from '@/lib/security/attestation';

async function handleScan(params: {
  targetWallet: string;
  chainId: number;
  linkId: string;
  c?: string | null;
  sig?: string | null;
  crawlSettings?: Partial<LiveCrawlSettings>;
  includeGemini?: boolean;
  proofOfControlToken?: string | null;
}) {
  // Load policy and vault ONLY from the verified link authority (never from client query/body)
  const authority = await resolveVerifiedLinkAuthority({
    linkId: params.linkId,
    c: params.c,
    sig: params.sig,
  });

  if (!authority.ok) {
    return NextResponse.json(
      {
        success: false,
        errorCode: authority.errorCode,
        error:
          authority.reason ??
          'Payment link verification failed; scan refused.',
      },
      { status: 403 }
    );
  }

  const { scan, receipt } = await runFullScan({
    targetWallet: params.targetWallet,
    merchantWallet: authority.vaultAddress,
    chainId: params.chainId,
    policy: authority.policy,
    crawlSettings: params.crawlSettings,
    includeGemini: params.includeGemini,
  });

  const pocCheck = verifyProofOfControlToken(params.proofOfControlToken, {
    scannedAddress: scan.targetWallet,
    linkId: authority.linkId,
    chainId: params.chainId,
  });

  const proofOfControl =
    pocCheck.valid && pocCheck.payload?.proofOfControl === true;

  const scanAttestation = signScanAttestation({
    payer: scan.targetWallet,
    linkId: authority.linkId,
    verdict: scan.verdict,
    socketUnlocked: scan.socketUnlocked,
    proofOfControl,
    policy: authority.policy,
  });

  return NextResponse.json({
    success: true,
    scan,
    receipt,
    scanAttestation,
    proofOfControl,
    linkAuthority: {
      linkId: authority.linkId,
      trustLevel: authority.trustLevel,
      signer: authority.signer,
      vaultAddress: authority.vaultAddress,
    },
  });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const targetWallet =
    sp.get('targetWallet') ||
    sp.get('target_wallet') ||
    sp.get('wallet') ||
    '0x4F2a9c117034e8B1200499A1c3f88200000188E1';
  const linkId = (sp.get('linkId') || 'default').trim() || 'default';
  const chainId = Number(sp.get('chainId') || 42161);

  return handleScan({
    targetWallet,
    chainId,
    linkId,
    c: sp.get('c'),
    sig: sp.get('sig'),
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
    const chainId = Number(body.chainId ?? 42161);
    const crawlSettings =
      body.crawlSettings && typeof body.crawlSettings === 'object'
        ? (body.crawlSettings as Partial<LiveCrawlSettings>)
        : undefined;
    const proofOfControlToken =
      typeof body.proofOfControlToken === 'string'
        ? body.proofOfControlToken
        : null;
    const c = typeof body.c === 'string' ? body.c : null;
    const sig = typeof body.sig === 'string' ? body.sig : null;

    // Any client-supplied policy or merchantWallet/vault in the request body is ignored;
    // policy and vault are loaded strictly from the verified link authority.
    return handleScan({
      targetWallet,
      chainId,
      linkId,
      c,
      sig,
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
