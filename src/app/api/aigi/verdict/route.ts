import { NextRequest, NextResponse } from 'next/server';
import type {
  FirewallPolicyConfig,
  FirewallScanResult,
  HopDepth,
} from '@/types/veilpay';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';
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
    firewallEnabled: sp.get('firewallEnabled') || true,
    includeGemini: sp.get('includeGemini'),
  };

  const validation = validateWithZod(aigiVerdictQuerySchema, rawParams);
  if (!validation.success) {
    return NextResponse.json(validation, { status: 400 });
  }

  const {
    targetWallet,
    merchantWallet,
    maxHops,
    firewallEnabled,
    includeGemini,
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

  const scan = runVeilPayFirewallTraversal({
    targetWallet,
    merchantWallet,
    policy: {
      firewallEnabled,
      maxHops: maxHops as HopDepth,
      cleanLinkEnabled: true,
      unbundleEnabled: true,
      socketAutoBridgeEnabled: true,
      sybilBlockThreshold: 10,
    },
  });

  let receipt = generateAigiForensicReceipt(scan);
  if (includeGemini) {
    receipt = await maybeEnrichReceiptWithGemini(receipt);
  }

  return NextResponse.json({
    success: true,
    receipt,
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

  try {
    const rawBody = await request.json();
    const validation = validateWithZod(aigiVerdictBodySchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(validation, { status: 400 });
    }
    const body = validation.data;

    let scanResult: FirewallScanResult;

    if (
      body.scan &&
      typeof body.scan.verdict === 'string' &&
      Array.isArray(body.scan.evidenceEdges)
    ) {
      scanResult = body.scan as unknown as FirewallScanResult;
    } else {
      const maxHops = (body.policy?.maxHops ?? body.maxHops ?? 3) as HopDepth;

      scanResult = runVeilPayFirewallTraversal({
        targetWallet:
          body.targetWallet || '0x99B1c402881a77e3d90123456789aB00000FDead',
        merchantWallet: body.merchantWallet || '',
        policy: {
          firewallEnabled: body.policy?.firewallEnabled ?? true,
          maxHops,
          cleanLinkEnabled: body.policy?.cleanLinkEnabled ?? true,
          unbundleEnabled: body.policy?.unbundleEnabled ?? true,
          socketAutoBridgeEnabled: body.policy?.socketAutoBridgeEnabled ?? true,
          sybilBlockThreshold: body.policy?.sybilBlockThreshold ?? 10,
        },
      });
    }

    let receipt = generateAigiForensicReceipt(scanResult);
    if (body.includeGemini) {
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
      receipt = await maybeEnrichReceiptWithGemini(receipt);
    }

    return NextResponse.json({
      success: true,
      receipt,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to generate AIGI verdict',
      },
      { status: 400 }
    );
  }
}
