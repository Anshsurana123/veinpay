import { NextRequest, NextResponse } from 'next/server';
import { runFullScan } from '@/lib/graph/full-scan';
import {
  generateAigiForensicReceipt,
  maybeEnrichReceiptWithGemini,
} from '@/lib/aigi/verdict';
import {
  buildRateLimitExceededResponse,
  checkRateLimit,
  getClientIp,
} from '@/lib/security/rate-limit';
import {
  aigiVerdictBodySchema,
  aigiVerdictQuerySchema,
  validateWithZod,
} from '@/lib/validation/schemas';
import { resolveVerifiedLinkAuthority } from '@/lib/links';
import { verifyScanAttestation } from '@/lib/security/attestation';

async function handleAigiVerdict(params: {
  targetWallet: string;
  merchantWallet?: string;
  linkId?: string;
  c?: string | null;
  sig?: string | null;
  scanAttestation?: string | null;
  proofOfControlToken?: string | null;
  includeGemini?: boolean;
  simulated?: boolean;
}) {
  const isDemo = Boolean(
    params.simulated ||
      process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ||
      process.env.ALLOW_LOCAL_ENGINE === 'true'
  );

  // Authoritative production path requires a valid signed payment link and valid scanAttestation
  const hasLinkProof = Boolean(params.linkId || (params.c && params.sig));
  const hasAttestation = Boolean(params.scanAttestation);

  if (!hasLinkProof || !hasAttestation) {
    if (!isDemo) {
      return NextResponse.json(
        {
          success: false,
          errorCode: 'UNAUTHORIZED_VERDICT_REQUEST',
          error:
            'A valid signed payment link (?linkId= or ?c=&sig=) and scanAttestation are required to generate an authoritative forensic receipt.',
        },
        { status: 403 }
      );
    }

    // In demo mode, execute scan against demo/fixture dataset and return a DEMO receipt
    const scanResult = await runFullScan({
      targetWallet: params.targetWallet,
      merchantWallet: params.merchantWallet || '',
      chainId: 42161,
      policy: {
        firewallEnabled: true,
        maxHops: 3,
        cleanLinkEnabled: true,
        unbundleEnabled: true,
        socketAutoBridgeEnabled: true,
        sybilBlockThreshold: 10,
      },
      includeGemini: params.includeGemini,
    });

    let receipt = generateAigiForensicReceipt(scanResult.scan, {
      linkId: params.linkId || 'demo-link',
      payer: params.targetWallet,
      merchant: params.merchantWallet || '',
      demo: true,
    });

    if (params.includeGemini) {
      receipt = await maybeEnrichReceiptWithGemini(receipt);
    }

    return NextResponse.json({
      success: true,
      demo: true,
      receipt,
    });
  }

  // Resolve authoritative link policy & vault
  const authority = await resolveVerifiedLinkAuthority({
    linkId: params.linkId,
    c: params.c,
    sig: params.sig,
    allowEmptySimulatorVault: isDemo,
  });

  if (!authority.ok) {
    return NextResponse.json(
      {
        success: false,
        errorCode: authority.errorCode ?? 'INVALID_PAYMENT_LINK',
        error: authority.reason ?? 'Failed to resolve authoritative payment link.',
      },
      { status: 403 }
    );
  }

  // Verify scanAttestation
  const attestationResult = verifyScanAttestation({
    attestation: params.scanAttestation!,
    expectedPayer: params.targetWallet,
    expectedLinkId: authority.linkId,
    expectedPolicy: authority.policy,
  });

  if (!attestationResult.valid) {
    return NextResponse.json(
      {
        success: false,
        errorCode: 'INVALID_SCAN_ATTESTATION',
        error:
          attestationResult.reason ??
          'Scan attestation verification failed; cannot generate forensic receipt.',
      },
      { status: 403 }
    );
  }

  // Execute scan ONLY via runFullScan with authoritative policy (never client-supplied flags)
  const { scan } = await runFullScan({
    targetWallet: params.targetWallet,
    merchantWallet: authority.vaultAddress,
    chainId: authority.destinationChainId || 42161,
    policy: authority.policy,
    includeGemini: params.includeGemini,
  });

  let receipt = generateAigiForensicReceipt(scan, {
    linkId: authority.linkId,
    payer: params.targetWallet,
    merchant: authority.vaultAddress,
    demo: isDemo,
  });

  if (params.includeGemini) {
    receipt = await maybeEnrichReceiptWithGemini(receipt);
  }

  return NextResponse.json({
    success: true,
    receipt,
  });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('aigi-verdict', ip, {
    limit: 20,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  const sp = request.nextUrl.searchParams;
  const rawParams = {
    targetWallet:
      sp.get('targetWallet') ||
      sp.get('wallet') ||
      '0x99B1c402881a77e3d90123456789aB00000FDead',
    merchantWallet: sp.get('merchantWallet') || '',
    maxHops: sp.get('maxHops') || 3,
    firewallEnabled: sp.get('firewallEnabled') ?? undefined,
    includeGemini: sp.get('includeGemini') ?? undefined,
    linkId: sp.get('linkId') || undefined,
    c: sp.get('c') || undefined,
    sig: sp.get('sig') || undefined,
    scanAttestation:
      request.headers.get('x-scan-attestation') ||
      sp.get('scanAttestation') ||
      undefined,
    proofOfControlToken:
      request.headers.get('x-proof-of-control-token') ||
      sp.get('proofOfControlToken') ||
      undefined,
    simulated: sp.get('simulated') ?? undefined,
  };

  const validation = validateWithZod(aigiVerdictQuerySchema, rawParams);
  if (!validation.success) {
    return NextResponse.json(validation, { status: 400 });
  }

  const {
    targetWallet,
    merchantWallet,
    includeGemini,
    linkId,
    c,
    sig,
    scanAttestation,
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

  return handleAigiVerdict({
    targetWallet,
    merchantWallet,
    linkId,
    c,
    sig,
    scanAttestation,
    proofOfControlToken,
    includeGemini,
    simulated,
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('aigi-verdict', ip, {
    limit: 20,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body && typeof body === 'object' && 'scan' in body) {
    return NextResponse.json(
      {
        success: false,
        error: 'TAMPERED_SCAN_VERDICT',
        message:
          'Client-supplied scan payloads are strictly forbidden. Scans must be executed by the authoritative firewall pipeline.',
      },
      { status: 400 }
    );
  }

  const validation = validateWithZod(aigiVerdictBodySchema, body);
  if (!validation.success) {
    return NextResponse.json(validation, { status: 400 });
  }

  const {
    targetWallet,
    merchantWallet,
    includeGemini,
    linkId,
    c,
    sig,
    scanAttestation,
    proofOfControlToken,
    simulated,
  } = validation.data;

  const resolvedTarget =
    targetWallet || '0x99B1c402881a77e3d90123456789aB00000FDead';

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

  return handleAigiVerdict({
    targetWallet: resolvedTarget,
    merchantWallet,
    linkId,
    c,
    sig,
    scanAttestation:
      request.headers.get('x-scan-attestation') || scanAttestation,
    proofOfControlToken:
      request.headers.get('x-proof-of-control-token') || proofOfControlToken,
    includeGemini,
    simulated,
  });
}
