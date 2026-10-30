import { NextRequest, NextResponse } from 'next/server';
import type { LiveCrawlSettings } from '@/types/veinpay';
import { runFullScan } from '@/lib/graph/full-scan';
import { resolveVerifiedLinkAuthority } from '@/lib/links';
import { verifyProofOfControlToken } from '@/lib/session/proof-of-control';
import { signScanAttestation } from '@/lib/security/attestation';
import { getEventStore } from '@/lib/events/store';
import { createScanJob, updateScanJob } from '@/lib/storage/jobs';
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

export const maxDuration = 30;

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

  const isDemo = Boolean(
    params.simulated &&
      (process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ||
        process.env.ALLOW_LOCAL_ENGINE === 'true' ||
        authority.linkId.startsWith('0xsim') ||
        authority.linkId === 'default')
  );

  const { scan, receipt } = await runFullScan({
    targetWallet: params.targetWallet,
    merchantWallet: authority.vaultAddress,
    chainId: params.chainId,
    policy: authority.policy,
    crawlSettings: params.crawlSettings,
    includeGemini: params.includeGemini,
    linkId: authority.linkId,
  });

  // Record scan result event into events store
  try {
    const store = getEventStore();
    await store.recordEvent({
      linkId: authority.linkId,
      eventType: 'SCAN_RESULT',
      status: scan.socketUnlocked ? 'ALLOWED' : 'BLOCKED',
      simulated: isDemo,
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
    linkSigner: authority.signer || '',
    verdict: scan.verdict,
    socketUnlocked: scan.socketUnlocked,
    proofOfControl,
    policy: authority.policy,
    chainId: params.chainId,
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
    c: sp.get('c') || undefined,
    sig: sp.get('sig') || undefined,
    includeGemini: sp.get('includeGemini') ?? undefined,
    proofOfControlToken:
      request.headers.get('x-proof-of-control-token') ||
      sp.get('proofOfControlToken') ||
      undefined,
    simulated: sp.get('simulated') ?? undefined,
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

  const isAsync = sp.get('async') === 'true' || sp.get('mode') === 'async';
  if (isAsync) {
    const jobId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await createScanJob(jobId);

    // Kick off execution in background
    (async () => {
      try {
        await updateScanJob(jobId, { status: 'RUNNING' });
        const scanRes = await handleScan({
          targetWallet,
          chainId,
          linkId,
          c,
          sig,
          includeGemini,
          proofOfControlToken,
          simulated,
        });
        const json = await scanRes.json();
        if (scanRes.ok) {
          await updateScanJob(jobId, { status: 'COMPLETED', result: json });
        } else {
          await updateScanJob(jobId, {
            status: 'FAILED',
            error: json.error || 'Scan failed',
          });
        }
      } catch (err) {
        await updateScanJob(jobId, {
          status: 'FAILED',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return NextResponse.json(
      {
        jobId,
        status: 'PENDING',
        statusUrl: `/api/firewall/scan/jobs/${jobId}`,
      },
      { status: 202 }
    );
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

    const isAsync =
      rawBody.mode === 'async' ||
      rawBody.async === 'true' ||
      rawBody.async === true ||
      request.nextUrl.searchParams.get('async') === 'true' ||
      request.nextUrl.searchParams.get('mode') === 'async';

    if (isAsync) {
      const jobId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await createScanJob(jobId);

      (async () => {
        try {
          await updateScanJob(jobId, { status: 'RUNNING' });
          const scanRes = await handleScan({
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
          const json = await scanRes.json();
          if (scanRes.ok) {
            await updateScanJob(jobId, { status: 'COMPLETED', result: json });
          } else {
            await updateScanJob(jobId, {
              status: 'FAILED',
              error: json.error || 'Scan failed',
            });
          }
        } catch (err) {
          await updateScanJob(jobId, {
            status: 'FAILED',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();

      return NextResponse.json(
        {
          jobId,
          status: 'PENDING',
          statusUrl: `/api/firewall/scan/jobs/${jobId}`,
        },
        { status: 202 }
      );
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
