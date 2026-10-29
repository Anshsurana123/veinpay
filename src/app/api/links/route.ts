import { NextRequest, NextResponse } from 'next/server';
import {
  encodeSignedLinkPayloadToBase64Url,
  getStoredLinkRecord,
  isLinkRevoked,
  storeSignedLinkRecord,
  verifySignedPaymentLink,
} from '@/lib/links';
import type { SignedPaymentLinkPayload } from '@/types/veilpay';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const c = sp.get('c');
  const sig = sp.get('sig');
  const handle = sp.get('handle');
  const linkId = sp.get('linkId');

  if (c !== null || sig !== null) {
    const result = await verifySignedPaymentLink({
      encodedPayload: c,
      signature: sig,
      expectedHandle: handle,
    });
    if (!result.valid || !result.payload) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result, { status: 200 });
  }

  if (linkId) {
    if (isLinkRevoked(linkId)) {
      return NextResponse.json(
        {
          valid: false,
          errorCode: 'REVOKED_LINK',
          reason: `Payment link ${linkId} has been revoked by the receiver.`,
        },
        { status: 410 }
      );
    }
    const stored = getStoredLinkRecord(linkId);
    if (!stored) {
      return NextResponse.json(
        {
          valid: false,
          errorCode: 'MALFORMED_LINK_PAYLOAD',
          reason: `No stored payment link found for linkId "${linkId}".`,
        },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        valid: true,
        trustLevel: stored.trustLevel,
        payload: stored.payload,
        c: stored.encodedPayload,
        sig: stored.signature,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      valid: false,
      errorCode: 'UNSIGNED_LEGACY_LINK_REJECTED',
      reason: 'Provide ?c=<payload>&sig=<signature> or ?linkId=<id> to verify a payment link.',
    },
    { status: 400 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      payload?: SignedPaymentLinkPayload;
      encodedPayload?: string;
      c?: string;
      signature?: string;
      sig?: string;
      origin?: string;
    };

    const signature = (body.signature ?? body.sig ?? '').trim();
    const encodedInput = body.encodedPayload ?? body.c ?? null;

    const verification = await verifySignedPaymentLink({
      payload: body.payload ?? null,
      encodedPayload: encodedInput,
      signature,
    });

    if (!verification.valid || !verification.payload) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: verification.errorCode ?? 'INVALID_SIGNATURE',
          reason:
            verification.reason ??
            'Payment link failed EIP-712 signature or schema verification.',
        },
        { status: 400 }
      );
    }

    const canonicalEncoded = encodeSignedLinkPayloadToBase64Url(
      verification.payload
    );

    const { record } = storeSignedLinkRecord({
      payload: verification.payload,
      encodedPayload: canonicalEncoded,
      signature: signature as `0x${string}`,
      trustLevel: verification.trustLevel ?? 'SIGNED_UNPROVEN',
    });

    const baseOrigin = (
      body.origin ||
      request.nextUrl.origin ||
      'https://veilpay.xyz'
    ).replace(/\/+$/, '');

    const url = `${baseOrigin}/pay/${encodeURIComponent(record.handle)}?c=${canonicalEncoded}&sig=${encodeURIComponent(record.signature)}`;

    return NextResponse.json(
      {
        ok: true,
        linkId: record.linkId,
        handle: record.handle,
        trustLevel: record.trustLevel,
        c: canonicalEncoded,
        sig: record.signature,
        url,
        payload: record.payload,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'MALFORMED_LINK_PAYLOAD',
        reason:
          err instanceof Error
            ? err.message
            : 'Failed to create signed payment link.',
      },
      { status: 400 }
    );
  }
}
