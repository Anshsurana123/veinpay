import { sha256HexSync } from './verdict';
import { verifyReceiptSignature, isDemoKey } from './receipt-signer';
import type { AigiForensicReceipt } from '@/types/veilpay';

export interface ReceiptVerificationResult {
  valid: boolean;
  verified?: boolean;
  demo?: boolean;
  error?: string;
  reason?: string;
  commitmentHash?: string;
  keyId?: string;
  algorithm?: string;
  verifiedAt?: string;
}

export function verifyAigiReceiptData(params: {
  canonicalPayloadJson?: string;
  commitmentHash?: string;
  cryptographicAuditHash?: string;
  signature?: string;
  keyId?: string;
  expiresAt?: string;
  receipt?: Partial<AigiForensicReceipt>;
}): ReceiptVerificationResult {
  const canonicalJson =
    params.canonicalPayloadJson ?? params.receipt?.canonicalPayloadJson;
  const providedHash =
    params.commitmentHash ??
    params.cryptographicAuditHash ??
    params.receipt?.commitmentHash ??
    params.receipt?.cryptographicAuditHash;
  const signature = params.signature ?? params.receipt?.signature;
  const keyId = params.keyId ?? params.receipt?.keyId;

  if (!canonicalJson || typeof canonicalJson !== 'string') {
    return {
      valid: false,
      error: 'MISSING_CANONICAL_PAYLOAD',
      reason: 'canonicalPayloadJson is required for cryptographic verification.',
    };
  }

  if (!signature || typeof signature !== 'string') {
    return {
      valid: false,
      error: 'MISSING_SIGNATURE',
      reason: 'Ed25519 signature is required for signed receipt verification.',
    };
  }

  // 1. Recompute deterministic SHA-256 commitment hash
  const computedHash = `0x${sha256HexSync(canonicalJson)}`;

  if (
    providedHash &&
    providedHash.trim().toLowerCase() !== computedHash.toLowerCase()
  ) {
    return {
      valid: false,
      error: 'COMMITMENT_HASH_MISMATCH',
      reason: `Provided commitment hash (${providedHash}) does not match canonical payload SHA-256 (${computedHash}).`,
    };
  }

  // 2. Parse canonical payload to check expiration
  let parsedPayload: Record<string, unknown> | null = null;
  try {
    parsedPayload = JSON.parse(canonicalJson) as Record<string, unknown>;
  } catch {
    return {
      valid: false,
      error: 'MALFORMED_CANONICAL_PAYLOAD',
      reason: 'canonicalPayloadJson is not valid JSON.',
    };
  }

  const effectiveExpiresAt =
    params.expiresAt ??
    (params.receipt?.expiresAt as string | undefined) ??
    (parsedPayload?.expiresAt as string | undefined);

  if (effectiveExpiresAt && typeof effectiveExpiresAt === 'string') {
    const expiresMs = Date.parse(effectiveExpiresAt);
    const gracePeriodMs = 60_000; // 60s grace
    if (Number.isFinite(expiresMs) && Date.now() > expiresMs + gracePeriodMs) {
      return {
        valid: false,
        error: 'EXPIRED_RECEIPT',
        reason: `Compliance receipt expired at ${effectiveExpiresAt}.`,
      };
    }
  }

  // 3. Cryptographically verify Ed25519 signature across registered keys
  const sigVerification = verifyReceiptSignature({
    commitmentHash: computedHash,
    signature,
    keyId,
  });

  if (!sigVerification.valid) {
    return {
      valid: false,
      error: 'INVALID_SIGNATURE',
      reason:
        sigVerification.reason ??
        'Receipt Ed25519 signature failed verification.',
      commitmentHash: computedHash,
    };
  }

  const isDemo =
    Boolean(sigVerification.isDemo) ||
    Boolean(parsedPayload?.demo) ||
    (keyId ? isDemoKey(keyId) : false);

  return {
    valid: true,
    verified: true,
    demo: isDemo,
    commitmentHash: computedHash,
    keyId: keyId ?? 'veilpay-ed25519-v1',
    algorithm: 'Ed25519',
    verifiedAt: new Date().toISOString(),
  };
}
