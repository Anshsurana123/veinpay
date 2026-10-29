import { NextRequest, NextResponse } from 'next/server';
import { verifyProofOfControlSignature } from '@/lib/session/proof-of-control';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      nonce?: string;
      linkId?: string;
      scannedAddress?: string;
      chainId?: number;
      expiresAt?: string;
      signature?: string;
    };

    const nonce = (body.nonce ?? '').trim();
    const linkId = (body.linkId ?? 'default').trim();
    const scannedAddress = (body.scannedAddress ?? '').trim();
    const chainId = Number(body.chainId ?? 0);
    const expiresAt = (body.expiresAt ?? '').trim();
    const signature = (body.signature ?? '').trim();

    if (
      !nonce ||
      !scannedAddress ||
      !expiresAt ||
      !signature.startsWith('0x') ||
      !Number.isInteger(chainId) ||
      chainId <= 0
    ) {
      return NextResponse.json(
        {
          valid: false,
          reason:
            'Missing required fields (nonce, linkId, scannedAddress, chainId, expiresAt, signature).',
        },
        { status: 400 }
      );
    }

    const verification = await verifyProofOfControlSignature({
      nonce,
      linkId,
      scannedAddress,
      chainId,
      expiresAt,
      signature: signature as `0x${string}`,
    });

    if (!verification.valid) {
      return NextResponse.json(verification, { status: 401 });
    }

    return NextResponse.json(verification, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        valid: false,
        reason:
          err instanceof Error
            ? err.message
            : 'Failed to verify proof-of-control signature',
      },
      { status: 500 }
    );
  }
}
