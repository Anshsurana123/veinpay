import { NextRequest, NextResponse } from 'next/server';
import {
  encodeSignedLinkPayloadToBase64Url,
  getStoredLinkRecord,
  getStoredLinkRecordAsync,
  isLinkRevoked,
  isLinkRevokedAsync,
  storeSignedLinkRecord,
  verifySignedPaymentLink,
} from '@/lib/links';
import {
  buildRateLimitExceededResponse,
  checkRateLimit,
  getClientIp,
} from '@/lib/security/rate-limit';
import type { SignedPaymentLinkPayload } from '@/types/veinpay';

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('get-link', ip, {
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

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

  const targetLookupKey = linkId || handle;
  if (targetLookupKey) {
    const isRevoked =
      isLinkRevoked(targetLookupKey) ||
      (await isLinkRevokedAsync(targetLookupKey));

    if (isRevoked) {
      return NextResponse.json(
        {
          valid: false,
          errorCode: 'REVOKED_LINK',
          reason: `Payment link ${targetLookupKey} has been revoked by the receiver.`,
        },
        { status: 410 }
      );
    }

    const stored =
      getStoredLinkRecord(targetLookupKey) ||
      (await getStoredLinkRecordAsync(targetLookupKey));

    if (!stored) {
      return NextResponse.json(
        {
          valid: false,
          errorCode: 'MALFORMED_LINK_PAYLOAD',
          reason: `No stored payment link found for "${targetLookupKey}".`,
        },
        { status: 404 }
      );
    }

    // Re-verify signature on read per P0-3
    const reVerify = await verifySignedPaymentLink({
      encodedPayload: stored.encodedPayload,
      signature: stored.signature,
    });

    if (!reVerify.valid || !reVerify.payload) {
      return NextResponse.json(
        {
          valid: false,
          errorCode: reVerify.errorCode ?? 'INVALID_SIGNATURE',
          reason:
            reVerify.reason ??
            'Stored payment link signature failed re-verification on read.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        valid: true,
        trustLevel: reVerify.trustLevel ?? stored.trustLevel,
        payload: reVerify.payload,
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
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('create-link', ip, {
    limit: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

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

    const { record, handleCollision } = storeSignedLinkRecord({
      payload: verification.payload,
      encodedPayload: canonicalEncoded,
      signature: signature as `0x${string}`,
      trustLevel: verification.trustLevel ?? 'SIGNED_UNPROVEN',
      allowHandleCollision: true,
    });

    const baseOrigin = (
      body.origin ||
      request.nextUrl.origin ||
      'https://veinpay.xyz'
    ).replace(/\/+$/, '');

    const url = `${baseOrigin}/pay/${encodeURIComponent(record.handle)}?c=${canonicalEncoded}&sig=${encodeURIComponent(record.signature)}`;
    const shortUrl = `${baseOrigin}/pay/${encodeURIComponent(record.handle)}`;

    return NextResponse.json(
      {
        ok: true,
        record,
        url,
        shortUrl,
        handleStatus: handleCollision ? 'NOT_OWNED_BY_SIGNER' : 'OWNED',
        warning: handleCollision
          ? `Handle "${record.handle}" is already owned by a different signer; short link routes to previous owner.`
          : undefined,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'STORE_LINK_FAILED',
        reason:
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while storing payment link.',
      },
      { status: 500 }
    );
  }
}
