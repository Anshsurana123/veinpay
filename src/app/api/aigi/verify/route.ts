import { NextRequest, NextResponse } from 'next/server';
import { sha256HexSync } from '@/lib/aigi/verdict';
import { verifyReceiptSignature } from '@/lib/aigi/receipt-signer';
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
    };

    const canonicalJson =
      body.canonicalPayloadJson ?? body.receipt?.canonicalPayloadJson;
    const providedHash =
      body.commitmentHash ??
      body.cryptographicAuditHash ??
      body.receipt?.commitmentHash ??
      body.receipt?.cryptographicAuditHash;
    const signature = body.signature ?? body.receipt?.signature;
    const keyId = body.keyId ?? body.receipt?.keyId;

    if (!canonicalJson || typeof canonicalJson !== 'string') {
      return NextResponse.json(
        {
          valid: false,
          error: 'MISSING_CANONICAL_PAYLOAD',
          reason: 'canonicalPayloadJson is required for cryptographic verification.',
        },
        { status: 400 }
      );
    }

    if (!signature || typeof signature !== 'string') {
      return NextResponse.json(
        {
          valid: false,
          error: 'MISSING_SIGNATURE',
          reason: 'Ed25519 signature is required for signed receipt verification.',
        },
        { status: 400 }
      );
    }

    // 1. Recompute deterministic SHA-256 commitment hash
    const computedHash = `0x${sha256HexSync(canonicalJson)}`;

    if (
      providedHash &&
      providedHash.trim().toLowerCase() !== computedHash.toLowerCase()
    ) {
      return NextResponse.json(
        {
          valid: false,
          error: 'COMMITMENT_HASH_MISMATCH',
          reason: `Provided commitment hash (${providedHash}) does not match canonical payload SHA-256 (${computedHash}).`,
        },
        { status: 400 }
      );
    }

    // 2. Cryptographically verify Ed25519 signature
    const sigVerification = verifyReceiptSignature({
      commitmentHash: computedHash,
      signature,
      keyId,
    });

    if (!sigVerification.valid) {
      return NextResponse.json(
        {
          valid: false,
          error: 'INVALID_SIGNATURE',
          reason:
            sigVerification.reason ??
            'Receipt Ed25519 signature failed verification.',
          commitmentHash: computedHash,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        valid: true,
        verified: true,
        commitmentHash: computedHash,
        keyId: keyId ?? 'veilpay-ed25519-v1',
        algorithm: 'Ed25519',
        verifiedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        valid: false,
        error: 'VERIFICATION_ERROR',
        reason:
          err instanceof Error
            ? err.message
            : 'Internal error during receipt verification',
      },
      { status: 400 }
    );
  }
}
