import { createHmac, timingSafeEqual } from 'crypto';
import type { FirewallPolicyConfig, VerdictStatus } from '@/types/veilpay';
import { AUTHORITATIVE_DEFAULT_POLICY } from '@/lib/graph/full-scan';

export interface ScanAttestationPayload {
  payer: string;
  linkId: string;
  verdict: VerdictStatus;
  socketUnlocked: boolean;
  proofOfControl: boolean;
  policyHash: string;
  issuedAt: string;
  expiresAt: string;
}

const DEFAULT_ATTESTATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getAttestationSecret(): string {
  return (
    process.env.VEILPAY_ATTESTATION_SECRET?.trim() ||
    process.env.VEILPAY_SESSION_SECRET?.trim() ||
    process.env.RECEIPT_SIGNING_KEY?.trim() ||
    'veilpay-dev-ephemeral-attestation-hmac-secret-2026'
  );
}

export function computeCanonicalPolicyHash(policy: FirewallPolicyConfig): string {
  const canonical = JSON.stringify({
    cleanLinkEnabled: Boolean(policy.cleanLinkEnabled),
    firewallEnabled: Boolean(policy.firewallEnabled),
    maxHops: Number(policy.maxHops),
    socketAutoBridgeEnabled: Boolean(policy.socketAutoBridgeEnabled),
    sybilBlockThreshold: Number(policy.sybilBlockThreshold),
    unbundleEnabled: Boolean(policy.unbundleEnabled),
  });
  return createHmac('sha256', 'veilpay-policy-domain-v1')
    .update(canonical)
    .digest('hex');
}

export function isVerdictAllowedForQuote(
  verdict: VerdictStatus,
  socketUnlocked: boolean
): boolean {
  if (!socketUnlocked) return false;
  return (
    verdict === 'VERIFIED_CLEAN' ||
    verdict === 'WARNING_SYBIL' ||
    verdict === 'ADVISORY_BYPASSED'
  );
}

export function signScanAttestation(params: {
  payer: string;
  linkId: string;
  verdict: VerdictStatus;
  socketUnlocked: boolean;
  proofOfControl: boolean;
  policy: FirewallPolicyConfig;
  ttlMs?: number;
  nowMs?: number;
}): string {
  const now = params.nowMs ?? Date.now();
  const ttl = params.ttlMs ?? DEFAULT_ATTESTATION_TTL_MS;
  const payload: ScanAttestationPayload = {
    payer: params.payer.trim().toLowerCase(),
    linkId: params.linkId.trim() || 'default',
    verdict: params.verdict,
    socketUnlocked: Boolean(params.socketUnlocked),
    proofOfControl: Boolean(params.proofOfControl),
    policyHash: computeCanonicalPolicyHash(params.policy),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
  };

  const canonicalJson = JSON.stringify({
    expiresAt: payload.expiresAt,
    issuedAt: payload.issuedAt,
    linkId: payload.linkId,
    payer: payload.payer,
    policyHash: payload.policyHash,
    proofOfControl: payload.proofOfControl,
    socketUnlocked: payload.socketUnlocked,
    verdict: payload.verdict,
  });

  const encoded = Buffer.from(canonicalJson, 'utf8').toString('base64url');
  const mac = createHmac('sha256', getAttestationSecret())
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${mac}`;
}

export function verifyScanAttestation(
  attestation: string | null | undefined,
  expected: {
    payer: string;
    linkId?: string;
    policy?: FirewallPolicyConfig;
    requireProofOfControl?: boolean;
    nowMs?: number;
  }
): {
  valid: boolean;
  reason?: string;
  payload?: ScanAttestationPayload;
} {
  if (!attestation || typeof attestation !== 'string' || !attestation.includes('.')) {
    return {
      valid: false,
      reason: 'Missing or malformed server scanAttestation token.',
    };
  }

  const [encoded, mac] = attestation.split('.');
  if (!encoded || !mac) {
    return {
      valid: false,
      reason: 'Malformed scanAttestation token segments.',
    };
  }

  const expectedMac = createHmac('sha256', getAttestationSecret())
    .update(encoded)
    .digest('base64url');

  const macBuf = Buffer.from(mac, 'utf8');
  const expBuf = Buffer.from(expectedMac, 'utf8');
  if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) {
    return {
      valid: false,
      reason: 'Invalid scanAttestation HMAC signature.',
    };
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as ScanAttestationPayload;

    const now = expected.nowMs ?? Date.now();
    const expMs = Date.parse(parsed.expiresAt);
    if (!Number.isFinite(expMs) || now > expMs) {
      return {
        valid: false,
        reason: 'Server scanAttestation has expired.',
      };
    }

    if (parsed.payer.toLowerCase() !== expected.payer.trim().toLowerCase()) {
      return {
        valid: false,
        reason: `Scan attestation payer (${parsed.payer}) does not match quote userAddress (${expected.payer}).`,
      };
    }

    if (expected.linkId && parsed.linkId !== expected.linkId.trim()) {
      return {
        valid: false,
        reason: `Scan attestation linkId (${parsed.linkId}) does not match requested linkId (${expected.linkId}).`,
      };
    }

    if (expected.policy) {
      const expectedHash = computeCanonicalPolicyHash(expected.policy);
      if (parsed.policyHash !== expectedHash) {
        return {
          valid: false,
          reason: 'Scan attestation policyHash does not match verified link policy.',
        };
      }
    }

    const requirePoC = expected.requireProofOfControl ?? true;
    if (requirePoC && parsed.proofOfControl !== true) {
      return {
        valid: false,
        reason:
          'Scan attestation does not carry proofOfControl=true. Connect wallet and sign Proof of Control before requesting a quote.',
      };
    }

    if (!isVerdictAllowedForQuote(parsed.verdict, parsed.socketUnlocked)) {
      return {
        valid: false,
        reason: `Scan attestation verdict (${parsed.verdict}) blocks quote generation.`,
      };
    }

    return { valid: true, payload: parsed };
  } catch {
    return {
      valid: false,
      reason: 'Failed to decode scanAttestation payload.',
    };
  }
}

export interface VerifiedLinkPolicyRecord {
  linkId: string;
  policy: FirewallPolicyConfig;
  vaultAddress?: string;
}

const verifiedLinkPolicyStore = new Map<string, VerifiedLinkPolicyRecord>();

export function registerVerifiedLinkPolicy(record: VerifiedLinkPolicyRecord): void {
  verifiedLinkPolicyStore.set(record.linkId.trim(), record);
}

export function getVerifiedLinkPolicy(linkId?: string | null): VerifiedLinkPolicyRecord {
  const key = (linkId ?? '').trim();
  if (key && verifiedLinkPolicyStore.has(key)) {
    return verifiedLinkPolicyStore.get(key)!;
  }
  return {
    linkId: key || 'default',
    policy: { ...AUTHORITATIVE_DEFAULT_POLICY },
  };
}

export function clearVerifiedLinkPolicyStoreForTests(): void {
  verifiedLinkPolicyStore.clear();
}
