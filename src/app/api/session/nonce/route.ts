import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { issueProofOfControlNonce } from '@/lib/session/proof-of-control';
import { resolveVerifiedLinkAuthority } from '@/lib/links';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      linkId?: string;
      vaultAddress?: string;
      c?: string;
      sig?: string;
      scannedAddress?: string;
      chainId?: number;
    };

    let linkId = (body.linkId ?? 'default').trim();
    let vaultAddress = (body.vaultAddress ?? '').trim();
    const scannedAddress = (body.scannedAddress ?? '').trim();
    const chainId = Number(body.chainId ?? 8453);

    // If signed link parameters are provided, bind the verified authority linkId and vaultAddress
    if (body.c || body.sig || linkId !== 'default') {
      const authority = await resolveVerifiedLinkAuthority({
        linkId,
        c: body.c,
        sig: body.sig,
      });
      if (authority.ok && authority.vaultAddress) {
        linkId = authority.linkId;
        vaultAddress = authority.vaultAddress;
      }
    }

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
      vaultAddress,
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
