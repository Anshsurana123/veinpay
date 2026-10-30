import { NextRequest, NextResponse } from 'next/server';
import { getEventStore } from '@/lib/events/store';
import {
  issueReadActivityChallenge,
  resolveVerifiedLinkAuthority,
  verifyReadActivitySignature,
} from '@/lib/links';
import type { ThreatMetricsSummary } from '@/lib/events/types';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const linkId = sp.get('linkId');

  if (sp.get('challenge') === 'true' || sp.get('action') === 'challenge') {
    const targetLinkId = (linkId ?? 'default').trim();
    const challenge = issueReadActivityChallenge(targetLinkId);
    return NextResponse.json({ ok: true, challenge }, { status: 200 });
  }

  const store = getEventStore();

  if (!linkId) {
    const signer =
      request.headers.get('x-signer-address') ||
      request.headers.get('x-auth-signer') ||
      sp.get('signer');
    const sig =
      request.headers.get('x-read-auth-signature') ||
      request.headers.get('x-auth-signature') ||
      sp.get('sig');
    const nonce =
      request.headers.get('x-read-auth-nonce') ||
      request.headers.get('x-auth-nonce') ||
      sp.get('nonce');
    const expiresAt =
      request.headers.get('x-read-auth-expires-at') ||
      request.headers.get('x-auth-expires-at') ||
      sp.get('expiresAt');

    if (!signer || !sig || !nonce || !expiresAt) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: 'UNAUTHORIZED_ACCESS',
          reason:
            'Authentication required to read event logs: specify linkId with its ReadActivity signature, or authenticate the receiver signer wallet to read events.',
        },
        { status: 401 }
      );
    }

    const authResult = await verifyReadActivitySignature({
      linkId: 'ALL',
      nonce,
      expiresAt,
      signature: sig as `0x${string}`,
      expectedSigner: signer,
    });

    if (!authResult.valid) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: 'UNAUTHORIZED_ACCESS',
          reason: authResult.reason ?? 'Invalid ReadActivity signature for signer.',
        },
        { status: 401 }
      );
    }

    const allEvents = await store.getEvents({});
    const signerLower = signer.toLowerCase();
    const filteredEvents = allEvents.filter(
      (e) =>
        e.receiverVault?.toLowerCase() === signerLower ||
        e.payerAddress?.toLowerCase() === signerLower
    );

    const realFiltered = filteredEvents.filter((e) => !e.simulated);
    const metrics: ThreatMetricsSummary = {
      totalThreatsIntercepted: realFiltered.filter((e) => e.status === 'BLOCKED').length,
      totalSettledVolumeUsd: realFiltered
        .filter((e) => e.status === 'CONFIRMED')
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
      liveEventsCount: realFiltered.length,
      isPersistent: store.isPersistent,
    };

    return NextResponse.json({
      ok: true,
      isPersistent: store.isPersistent,
      metrics,
      events: filteredEvents,
    });
  }

  // When linkId is provided, authenticate against the link signer
  const sig =
    request.headers.get('x-read-auth-signature') ||
    request.headers.get('x-auth-signature') ||
    sp.get('sig');
  const nonce =
    request.headers.get('x-read-auth-nonce') ||
    request.headers.get('x-auth-nonce') ||
    sp.get('nonce');
  const expiresAt =
    request.headers.get('x-read-auth-expires-at') ||
    request.headers.get('x-auth-expires-at') ||
    sp.get('expiresAt');
  const c = sp.get('c');

  const authority = await resolveVerifiedLinkAuthority({ linkId, c });
  const expectedSigner = authority.signer;

  if (!expectedSigner) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'UNAUTHORIZED_RECEIVER_ACCESS',
        reason: `No registered or verified signer found for payment link "${linkId}".`,
      },
      { status: 401 }
    );
  }

  if (!sig || !nonce || !expiresAt) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'UNAUTHORIZED_RECEIVER_ACCESS',
        reason:
          'Receiver wallet authentication required: sign an EIP-712 ReadActivity challenge with the link signer wallet.',
      },
      { status: 401 }
    );
  }

  const authResult = await verifyReadActivitySignature({
    linkId,
    nonce,
    expiresAt,
    signature: sig as `0x${string}`,
    expectedSigner,
  });

  if (!authResult.valid) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'UNAUTHORIZED_RECEIVER_ACCESS',
        reason:
          authResult.reason ??
          'Invalid EIP-712 ReadActivity signature from link signer.',
      },
      { status: 401 }
    );
  }

  const events = await store.getEvents({ linkId });
  const metrics = await store.getThreatMetrics(linkId);

  return NextResponse.json({
    ok: true,
    isPersistent: store.isPersistent,
    metrics,
    events,
  });
}

/**
 * Public event injection is strictly disabled per P0-4 audit mandate.
 * Events are written exclusively server-side by authenticated pipelines:
 * - Scan routes (/api/firewall/scan)
 * - Quote routes (/api/socket/quote)
 * - Settlement verification (/api/settlements/report)
 */
export async function POST(request: NextRequest) {
  // Reject unauthenticated injection
  return NextResponse.json(
    {
      ok: false,
      errorCode: 'UNAUTHORIZED_ACCESS',
      error:
        'Direct unauthenticated event injection is disabled. Settlement events must be submitted to /api/settlements/report with a valid scanAttestation and Proof of Control.',
    },
    { status: 401 }
  );
}
