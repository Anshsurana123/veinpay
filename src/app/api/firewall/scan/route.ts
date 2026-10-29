import { NextRequest, NextResponse } from 'next/server';
import type { LiveCrawlSettings } from '@/types/veilpay';
import { runFullScan } from '@/lib/graph/full-scan';
import { resolveVerifiedLinkAuthority } from '@/lib/links';
import { verifyProofOfControlToken } from '@/lib/session/proof-of-control';
import { signScanAttestation } from '@/lib/security/attestation';
import { getEventStore } from '@/lib/events/store';
import {
  buildRateLimitExceededResponse,
  checkRateLimit,
  getClientIp,
} from '@/lib/security/rate-limit';
import {
  scanBodySchema,
  scanQuerySchema,
  validateWithZod,
} from '@/lib/validation/schemas';

async function handleScan(params: {
  targetWallet: string;
  chainId: number;
  linkId: string;
  c?: string | null;
  sig?: string | null;
  crawlSettings?: Partial<LiveCrawlSettings>;
  includeGemini?: boolean;
  proofOfControlToken?: string | null;
  simulated?: boolean;
}) {
  // Load policy and vault ONLY from the verified link authority (never from client query/body)
  const authority = await resolveVerifiedLinkAuthority({
    linkId: params.linkId,
    c: params.c,
    sig: params.sig,
    allowEmptySimulatorVault: true,
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

  // Record scan result event into events store
  try {
    const store = getEventStore();
    await store.recordEvent({
      linkId: authority.linkId,
      eventType: 'SCAN_RESULT',
      status: scan.socketUnlocked ? 'ALLOWED' : 'BLOCKED',
      simulated: Boolean(params.simulated),
      payerAddress: scan.targetWallet,
      receiverVault: authority.vaultAddress,
      amount: '0.00',
      asset: 'USDC',
      sourceChainId: params.chainId,
      sourceChainName: params.chainId === 42161 ? 'Arbitrum' : 'EVM',
      verdict: scan.verdict,
      hopDistance: scan.minTaintHop,
      latencyMs: scan.executionTimeMs,
      executionSource: scan.executionSource,
      sha256Hash: receipt.cryptographicAuditHash,
    });
  } catch {
    // Non-blocking event logging
  }

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
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('firewall-scan', ip, {
    limit: 25,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  const sp = request.nextUrl.searchParams;
  const rawParams = {
    targetWallet:
      sp.get('targetWallet') ||
      sp.get('target_wallet') ||
      sp.get('wallet') ||
      undefined,
    chainId: sp.get('chainId') || undefined,
    linkId: sp.get('linkId') || undefined,
    c: sp.get('c'),
    sig: sp.get('sig'),
    includeGemini: sp.get('includeGemini'),
    proofOfControlToken: sp.get('proofOfControlToken'),
    simulated: sp.get('simulated'),
  };

  const validation = validateWithZod(scanQuerySchema, rawParams);
  if (!validation.success) {
    return NextResponse.json(validation, { status: 400 });
  }

  const {
    targetWallet,
    chainId,
    linkId,
    c,
    sig,
    includeGemini,
    proofOfControlToken,
    simulated,
  } = validation.data;

  if (includeGemini) {
    const geminiLimit = await checkRateLimit('gemini-narration', ip, {
      limit: 5,
      windowSeconds: 60,
    });
    if (!geminiLimit.allowed) {
      return buildRateLimitExceededResponse(
        geminiLimit,
        'Gemini narration rate limit exceeded (maximum 5 requests per minute).'
      );
    }
  }

  return handleScan({
    targetWallet,
    chainId,
    linkId,
    c,
    sig,
    includeGemini,
    proofOfControlToken,
    simulated,
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('firewall-scan', ip, {
    limit: 25,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  try {
    const rawBody = (await request.json()) as Record<string, unknown>;
    const validation = validateWithZod(scanBodySchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(validation, { status: 400 });
    }

    const {
      targetWallet,
      chainId,
      linkId,
      c,
      sig,
      crawlSettings,
      includeGemini,
      proofOfControlToken,
      simulated,
    } = validation.data;

    if (includeGemini) {
      const geminiLimit = await checkRateLimit('gemini-narration', ip, {
        limit: 5,
        windowSeconds: 60,
      });
      if (!geminiLimit.allowed) {
        return buildRateLimitExceededResponse(
          geminiLimit,
          'Gemini narration rate limit exceeded (maximum 5 requests per minute).'
        );
      }
    }

    // Any client-supplied policy or merchantWallet/vault in the request body is ignored;
    // policy and vault are loaded strictly from the verified link authority.
    return handleScan({
      targetWallet,
      chainId,
      linkId,
      c,
      sig,
      crawlSettings,
      includeGemini,
      proofOfControlToken,
      simulated,
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
