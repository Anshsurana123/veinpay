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

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const targetWallet =
    sp.get('targetWallet') ||
    sp.get('wallet') ||
    '0x99B1c402881a77e3d90123456789aB00000FDead';
  const maxHops = Math.min(
    5,
    Math.max(1, Number(sp.get('maxHops') || 3))
  ) as HopDepth;

  const scan = runVeilPayFirewallTraversal({
    targetWallet,
    merchantWallet: sp.get('merchantWallet') || '',
    policy: {
      firewallEnabled: sp.get('firewallEnabled') !== 'false',
      maxHops,
      cleanLinkEnabled: true,
      unbundleEnabled: true,
      socketAutoBridgeEnabled: true,
      sybilBlockThreshold: 10,
    },
  });

  let receipt = generateAigiForensicReceipt(scan);
  if (sp.get('includeGemini') === 'true') {
    receipt = await maybeEnrichReceiptWithGemini(receipt);
  }

  return NextResponse.json({
    success: true,
    receipt,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      scan?: FirewallScanResult;
      targetWallet?: string;
      merchantWallet?: string;
      maxHops?: number;
      policy?: Partial<FirewallPolicyConfig>;
      includeGemini?: boolean;
    };

    let scanResult: FirewallScanResult;

    if (body.scan && body.scan.verdict && Array.isArray(body.scan.evidenceEdges)) {
      scanResult = body.scan;
    } else {
      const maxHops = Math.min(
        5,
        Math.max(1, Number(body.policy?.maxHops ?? body.maxHops ?? 3))
      ) as HopDepth;

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
