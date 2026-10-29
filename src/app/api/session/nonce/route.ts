import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { issueProofOfControlNonce } from '@/lib/session/proof-of-control';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      linkId?: string;
      scannedAddress?: string;
      chainId?: number;
    };

    const linkId = (body.linkId ?? 'default').trim();
    const scannedAddress = (body.scannedAddress ?? '').trim();
    const chainId = Number(body.chainId ?? 8453);

    if (!isAddress(scannedAddress, { strict: false })) {
      return NextResponse.json(
        { error: 'Valid EVM scannedAddress is required to issue a proof-of-control nonce.' },
        { status: 400 }
      );
    }

    if (!Number.isInteger(chainId) || chainId <= 0) {
      return NextResponse.json(
        { error: 'Valid positive integer chainId is required.' },
        { status: 400 }
      );
    }

    const challenge = issueProofOfControlNonce({
      linkId,
      scannedAddress,
      chainId,
    });

    return NextResponse.json(challenge, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to issue proof-of-control nonce',
      },
      { status: 400 }
    );
  }
}
