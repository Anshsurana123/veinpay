import { NextRequest, NextResponse } from 'next/server';
import { getEventStore } from '@/lib/events/store';
import {
  issueReadActivityChallenge,
  resolveVerifiedLinkAuthority,
  verifyReadActivitySignature,
} from '@/lib/links';
import { verifyOnChainSettlementReceipt } from '@/lib/events/verify-receipt';
import type { VeilPayEventStatus } from '@/lib/events/types';
import type {
  PaymentAssetSymbol,
  VaultSettlementMode,
  VerdictStatus,
} from '@/types/veilpay';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const linkId = sp.get('linkId');

  if (sp.get('challenge') === 'true' || sp.get('action') === 'challenge') {
    const targetLinkId = (linkId ?? 'default').trim();
    const challenge = issueReadActivityChallenge(targetLinkId);
    return NextResponse.json({ ok: true, challenge }, { status: 200 });
  }

  const store = getEventStore();

  if (linkId) {
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
  }

  const events = await store.getEvents({ linkId: linkId ?? undefined });
  const metrics = await store.getThreatMetrics(linkId ?? undefined);

  return NextResponse.json({
    ok: true,
    isPersistent: store.isPersistent,
    metrics,
    events,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?:
        | 'record_scan'
        | 'record_settlement'
        | 'verify_receipt'
        | 'record_link_revocation'
        | 'record_cctp_state';
      linkId?: string;
      eventId?: string;
      simulated?: boolean;
      payerAddress?: string;
      payerLabel?: string;
      receiverVault?: string;
      amount?: string;
      asset?: PaymentAssetSymbol;
      sourceChainId?: number;
      sourceChainName?: string;
      destinationChainId?: number;
      verdict?: VerdictStatus;
      hopDistance?: number | null;
      latencyMs?: number;
      txHash?: string;
      burnTxHash?: string;
      mintTxHash?: string;
      cctpState?: VeilPayEventStatus;
      bridgeUsed?: string;
      sha256Hash?: string;
      settlementMode?: VaultSettlementMode;
      errorMessage?: string;
    };

    const action = body.action ?? 'record_scan';
    const store = getEventStore();
    const linkId = body.linkId || 'default-session';
    const simulated = Boolean(body.simulated);

    if (action === 'record_link_revocation') {
      const event = await store.recordEvent({
        id: body.eventId ?? `rev_${linkId}_${Date.now()}`,
        linkId,
        eventType: 'LINK_REVOCATION',
        status: 'REVOKED',
        simulated: false,
        payerAddress: '0x0000000000000000000000000000000000000000',
        receiverVault: body.receiverVault || '',
        amount: '0.00',
        asset: body.asset || 'USDC',
        sourceChainId: 0,
        sourceChainName: 'Network',
        errorMessage:
          body.errorMessage || `Payment link ${linkId} has been revoked.`,
      });

      return NextResponse.json({ ok: true, event }, { status: 201 });
    }

    if (action === 'record_cctp_state') {
      const cctpState = (body.cctpState ?? 'BURN_PENDING') as VeilPayEventStatus;
      const event = await store.recordEvent({
        id: body.burnTxHash
          ? `cctp_${body.burnTxHash}_${cctpState}`
          : body.eventId,
        linkId,
        eventType: 'CCTP_TRANSFER_STATE',
        status: cctpState,
        simulated,
        payerAddress:
          body.payerAddress || '0x0000000000000000000000000000000000000000',
        receiverVault: body.receiverVault || '',
        amount: body.amount || '0.00',
        asset: 'USDC',
        sourceChainId: body.sourceChainId || 84532,
        sourceChainName: body.sourceChainName || 'CCTP Testnet',
        destinationChainId: body.destinationChainId,
        txHash: body.txHash || body.mintTxHash || body.burnTxHash,
        errorMessage: body.errorMessage,
      });

      return NextResponse.json({ ok: true, event }, { status: 201 });
    }

    if (action === 'record_scan') {
      const isBlocked =
        body.verdict === 'INTERCEPTED_TAINT' ||
        body.verdict === 'INTERCEPTED_SYBIL' ||
        body.verdict === 'INTERCEPTED_POISONING';

      const event = await store.recordEvent({
        linkId,
        eventType: 'SCAN_RESULT',
        status: isBlocked ? 'BLOCKED' : 'ALLOWED',
        simulated,
        payerAddress: body.payerAddress || '0x0000000000000000000000000000000000000000',
        payerLabel: body.payerLabel,
        receiverVault: body.receiverVault || '',
        amount: body.amount || '0.00',
        asset: body.asset || 'USDC',
        sourceChainId: body.sourceChainId || 42161,
        sourceChainName: body.sourceChainName || 'Arbitrum',
        destinationChainId: body.destinationChainId,
        verdict: body.verdict || 'VERIFIED_CLEAN',
        hopDistance: body.hopDistance,
        latencyMs: body.latencyMs,
        sha256Hash: body.sha256Hash,
      });

      return NextResponse.json({ ok: true, event }, { status: 201 });
    }

    if (action === 'record_settlement') {
      const mode = body.settlementMode || 'EVM_SOCKET';
      const initialStatus =
        mode === 'BTC_SILENT_PAYMENT' || mode === 'XMR_SUBADDRESS'
          ? 'AWAITING_PAYMENT'
          : 'PENDING';

      const event = await store.recordEvent({
        id: body.eventId,
        linkId,
        eventType: 'SETTLEMENT_ATTEMPT',
        status: initialStatus,
        simulated,
        payerAddress: body.payerAddress || '0x0000000000000000000000000000000000000000',
        payerLabel: body.payerLabel,
        receiverVault: body.receiverVault || '',
        amount: body.amount || '0.00',
        asset: body.asset || 'USDC',
        sourceChainId: body.sourceChainId || 42161,
        sourceChainName: body.sourceChainName || 'Arbitrum',
        destinationChainId: body.destinationChainId,
        txHash: body.txHash,
        bridgeUsed: body.bridgeUsed,
        sha256Hash: body.sha256Hash,
      });

      return NextResponse.json({ ok: true, event }, { status: 201 });
    }

    if (action === 'verify_receipt') {
      if (!body.txHash && body.settlementMode === 'EVM_SOCKET') {
        return NextResponse.json(
          { ok: false, reason: 'txHash is required for EVM receipt verification' },
          { status: 400 }
        );
      }

      const verification = await verifyOnChainSettlementReceipt({
        txHash: body.txHash || '',
        chainId: body.sourceChainId || 42161,
        settlementMode: body.settlementMode || 'EVM_SOCKET',
        expectedReceiverVault: body.receiverVault,
      });

      let updatedEvent = null;
      if (body.eventId) {
        updatedEvent = await store.updateEvent(body.eventId, {
          status: verification.status,
          txHash: body.txHash,
          errorMessage:
            verification.status === 'FAILED' ? verification.reason : undefined,
        });
      }

      return NextResponse.json({
        ok: true,
        verification,
        event: updatedEvent,
      });
    }

    return NextResponse.json(
      { ok: false, reason: `Unknown action: "${action}"` },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason:
          err instanceof Error
            ? err.message
            : 'Failed to process event request.',
      },
      { status: 500 }
    );
  }
}
