import { NextRequest, NextResponse } from 'next/server';
import { verifyAigiReceiptData } from '@/lib/aigi/verify-helper';
import type { AigiForensicReceipt } from '@/types/veilpay';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      receipt?: Partial<AigiForensicReceipt>;
      canonicalPayloadJson?: string;
      commitmentHash?: string;
      cryptographicAuditHash?: string;
      signature?: string;
      keyId?: string;
      expiresAt?: string;
    };

    const result = verifyAigiReceiptData({
      receipt: body.receipt,
      canonicalPayloadJson: body.canonicalPayloadJson,
      commitmentHash: body.commitmentHash,
      cryptographicAuditHash: body.cryptographicAuditHash,
      signature: body.signature,
      keyId: body.keyId,
      expiresAt: body.expiresAt,
    });

    if (!result.valid) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        valid: false,
        error: 'INTERNAL_ERROR',
        reason:
          err instanceof Error
            ? err.message
            : 'Unknown receipt verification error.',
      },
      { status: 500 }
    );
  }
}
