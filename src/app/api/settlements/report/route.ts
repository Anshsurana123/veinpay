import { NextRequest, NextResponse } from 'next/server';
import { resolveVerifiedLinkAuthority } from '@/lib/links';
import {
  verifyScanAttestation,
  consumeScanAttestationJti,
} from '@/lib/security/attestation';
import { verifyProofOfControlToken } from '@/lib/session/proof-of-control';
import { verifyOnChainSettlementReceipt } from '@/lib/events/verify-receipt';
import { getEventStore } from '@/lib/events/store';
import { getStorage } from '@/lib/storage';
import {
  buildRateLimitExceededResponse,
  checkRateLimit,
  getClientIp,
} from '@/lib/security/rate-limit';
import {
  settlementReportBodySchema,
  validateWithZod,
} from '@/lib/validation/schemas';
import type { PaymentAssetSymbol, VaultSettlementMode } from '@/types/veilpay';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('report-settlement', ip, {
    limit: 20,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  try {
    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Malformed JSON body.' },
        { status: 400 }
      );
    }

    const validation = validateWithZod(settlementReportBodySchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(validation, { status: 400 });
    }

    const {
      linkId,
      c,
      sig,
      scanAttestation,
      proofOfControlToken,
      txHash,
      chainId,
      settlementMode,
      amount,
      asset,
      bridgeUsed,
      simulated,
    } = validation.data;

    // 1. Resolve authoritative link policy & receiver vault
    const authority = await resolveVerifiedLinkAuthority({
      linkId,
      c,
      sig,
      allowEmptySimulatorVault: simulated,
    });

    if (!authority.ok) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: authority.errorCode ?? 'INVALID_LINK',
          reason: authority.reason ?? 'Failed to resolve verified payment link.',
        },
        { status: 403 }
      );
    }

    // 2. Verify scanAttestation
    const attestationResult = verifyScanAttestation({
      attestation: scanAttestation,
      expectedLinkId: authority.linkId,
      expectedPolicy: authority.policy,
      expectedChainId: chainId,
    });

    if (!attestationResult.valid || !attestationResult.payload) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: 'INVALID_ATTESTATION',
          reason:
            attestationResult.reason ??
            'Scan attestation verification failed for this settlement.',
        },
        { status: 403 }
      );
    }

    const payer = attestationResult.payload.payer;

    // 3. Verify Proof of Control token binds authorized payer
    const pocResult = verifyProofOfControlToken(proofOfControlToken, {
      scannedAddress: payer,
      linkId: authority.linkId,
      chainId,
    });

    if (!pocResult.valid) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: 'INVALID_PROOF_OF_CONTROL',
          reason:
            pocResult.reason ??
            'Proof of control verification failed; sender not authorized.',
        },
        { status: 403 }
      );
    }

    // 4. Mark attestation JTI consumed to prevent replay attacks
    const jtiConsumed = await consumeScanAttestationJti(
      attestationResult.payload.jti
    );
    if (!jtiConsumed) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: 'REPLAYED_ATTESTATION',
          reason:
            'This scan attestation has already been consumed by a prior quote or settlement.',
        },
        { status: 409 }
      );
    }

    // 5. Idempotency check by txHash
    const storage = getStorage();
    if (txHash) {
      const existing = await storage.get<{ eventId: string; status: string }>(
        `settlement:tx:${txHash.toLowerCase()}`
      );
      if (existing) {
        return NextResponse.json(
          {
            ok: true,
            idempotent: true,
            status: existing.status,
            eventId: existing.eventId,
            reason: 'Settlement already recorded and verified previously.',
          },
          { status: 200 }
        );
      }
    }

    // 6. On-chain transaction verification
    const onChainVerification = await verifyOnChainSettlementReceipt({
      txHash: txHash || '',
      chainId,
      settlementMode: settlementMode as VaultSettlementMode,
      expectedReceiverVault: authority.vaultAddress,
      expectedPayer: payer,
      minAmount: authority.amount,
      asset,
      destinationChainId: authority.destinationChainId,
    });

    if (
      onChainVerification.status === 'FAILED' &&
      settlementMode === 'EVM_SOCKET'
    ) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: 'ON_CHAIN_VERIFICATION_FAILED',
          reason: onChainVerification.reason,
        },
        { status: 400 }
      );
    }

    // 7. Record verified settlement event
    const store = getEventStore();
    const event = await store.recordEvent({
      id: txHash ? `settle_${txHash.slice(2, 14)}` : undefined,
      linkId: authority.linkId,
      eventType:
        onChainVerification.status === 'CONFIRMED'
          ? 'SETTLEMENT_CONFIRMED'
          : 'SETTLEMENT_ATTEMPT',
      status: onChainVerification.status,
      simulated,
      payerAddress: payer,
      receiverVault: authority.vaultAddress,
      amount,
      asset: (asset || 'USDC') as PaymentAssetSymbol,
      sourceChainId: chainId,
      sourceChainName: `Chain ${chainId}`,
      destinationChainId: authority.destinationChainId,
      txHash,
      bridgeUsed,
      errorMessage:
        onChainVerification.status === 'FAILED'
          ? onChainVerification.reason
          : undefined,
    });

    // Record idempotency key for 30 days
    if (txHash) {
      await storage.set(
        `settlement:tx:${txHash.toLowerCase()}`,
        { eventId: event.id, status: event.status },
        { exSeconds: 86400 * 30 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        status: event.status,
        event,
        verification: onChainVerification,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'SETTLEMENT_REPORT_FAILED',
        reason:
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred processing settlement report.',
      },
      { status: 500 }
    );
  }
}
