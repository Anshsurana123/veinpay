import { NextRequest, NextResponse } from 'next/server';
import {
  markLinkRevoked,
  verifyRevokeLinkSignature,
  type RevokeLinkMessage,
} from '@/lib/links';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      linkId?: string;
      signer?: string;
      issuedAt?: string;
      signature?: string;
    };

    const linkId = (body.linkId ?? '').trim().toLowerCase();
    const signer = (body.signer ?? '').trim();
    const issuedAt = (body.issuedAt ?? '').trim();
    const signature = (body.signature ?? '').trim();

    if (!linkId || !signer || !issuedAt || !signature.startsWith('0x')) {
      return NextResponse.json(
        {
          ok: false,
          reason:
            'Missing required revocation fields (linkId, signer, issuedAt, signature).',
        },
        { status: 400 }
      );
    }

    const revokeMessage: RevokeLinkMessage = {
      linkId,
      signer: signer as `0x${string}`,
      issuedAt,
    };

    const check = await verifyRevokeLinkSignature({
      revokeMessage,
      signature: signature as `0x${string}`,
    });

    if (!check.valid) {
      return NextResponse.json(
        {
          ok: false,
          reason: check.reason ?? 'Revocation EIP-712 signature verification failed.',
        },
        { status: 401 }
      );
    }

    markLinkRevoked({
      linkId,
      signer,
      issuedAt,
    });

    return NextResponse.json(
      {
        ok: true,
        revoked: true,
        linkId,
        revokedAt: issuedAt,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason:
          err instanceof Error
            ? err.message
            : 'Failed to process link revocation.',
      },
      { status: 400 }
    );
  }
}
