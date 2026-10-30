import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { FirewallPolicyConfig, VerdictStatus } from '@/types/veilpay';
import { AUTHORITATIVE_DEFAULT_POLICY } from '@/lib/graph/full-scan';
import { getStorage } from '@/lib/storage';

export interface ScanAttestationPayload {
  jti: string;
  payer: string;
  linkId: string;
  linkSigner: string;
  verdict: VerdictStatus;
  socketUnlocked: boolean;
  proofOfControl: boolean;
  policyHash: string;
  chainId?: number;
  inputToken?: string;
  maxInputAmount?: string;
  issuedAt: string;
  expiresAt: string;
}

// 2 minutes TTL per P1-9
const DEFAULT_ATTESTATION_TTL_MS = 2 * 60 * 1000;

export function assertScanAttestationSecretConfigured(): void {
  const secret = process.env.VEILPAY_ATTESTATION_SECRET?.trim();
  const allowDev = process.env.VEILPAY_ALLOW_DEV_SECRETS === 'true';
  if (process.env.NODE_ENV === 'production' && !secret && !allowDev) {
    throw new Error(
      'FATAL: VEILPAY_ATTESTATION_SECRET is required in production.'
    );
  }
}

function getAttestationSecret(): string {
  const secret = process.env.VEILPAY_ATTESTATION_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && process.env.VEILPAY_ALLOW_DEV_SECRETS !== 'true') {
      throw new Error(
        'FATAL: VEILPAY_ATTESTATION_SECRET is required in production.'
      );
    }
    return 'veilpay-dev-ephemeral-attestation-hmac-secret-2026';
  }
  return secret;
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
    verdict === 'ADVISORY_BYPASSED' ||
    verdict === 'INCONCLUSIVE'
  );
}

export function signScanAttestation(params: {
  payer: string;
  linkId: string;
  linkSigner?: string;
  verdict: VerdictStatus;
  socketUnlocked: boolean;
  proofOfControl: boolean;
  policy: FirewallPolicyConfig;
  chainId?: number;
  inputToken?: string;
  maxInputAmount?: string;
  ttlMs?: number;
  nowMs?: number;
  jti?: string;
}): string {
  const now = params.nowMs ?? Date.now();
  const ttl = params.ttlMs ?? DEFAULT_ATTESTATION_TTL_MS;
  const jti = params.jti || `jti_${randomBytes(16).toString('hex')}`;

  const payload: ScanAttestationPayload = {
    jti,
    payer: params.payer.trim().toLowerCase(),
    linkId: params.linkId.trim() || 'default',
    linkSigner: (params.linkSigner ?? '').trim().toLowerCase(),
    verdict: params.verdict,
    socketUnlocked: Boolean(params.socketUnlocked),
    proofOfControl: Boolean(params.proofOfControl),
    policyHash: computeCanonicalPolicyHash(params.policy),
    chainId: params.chainId,
    inputToken: params.inputToken,
    maxInputAmount: params.maxInputAmount,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
  };

  const canonicalJson = JSON.stringify({
    chainId: payload.chainId,
    expiresAt: payload.expiresAt,
    inputToken: payload.inputToken,
    issuedAt: payload.issuedAt,
    jti: payload.jti,
    linkId: payload.linkId,
    linkSigner: payload.linkSigner,
    maxInputAmount: payload.maxInputAmount,
    payer: payload.payer,
    policyHash: payload.policyHash,
    proofOfControl: payload.proofOfControl,
    socketUnlocked: payload.socketUnlocked,
    verdict: payload.verdict,
  });

  const encoded = Buffer.from(canonicalJson, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const mac = createHmac('sha256', getAttestationSecret())
    .update(encoded)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${encoded}.${mac}`;
}

export async function consumeScanAttestationJti(
  jti: string,
  ttlSeconds = 300
): Promise<boolean> {
  const storage = getStorage();
  return storage.set(`jti:${jti}`, '1', { nx: true, exSeconds: ttlSeconds });
}

export async function isScanAttestationJtiConsumed(jti: string): Promise<boolean> {
  const storage = getStorage();
  const val = await storage.get<string>(`jti:${jti}`);
  return val !== null;
}

export function verifyScanAttestation(
  attestationOrParams:
    | string
    | null
    | undefined
    | {
        attestation?: string | null;
        expectedPayer?: string;
        expectedLinkId?: string;
        expectedPolicy?: FirewallPolicyConfig;
        expectedChainId?: number;
        expectedInputToken?: string;
        expectedInputAmount?: string;
        nowMs?: number;
      },
  maybeExpected?: {
    payer?: string;
    expectedPayer?: string;
    linkId?: string;
    expectedLinkId?: string;
    linkSigner?: string;
    policy?: FirewallPolicyConfig;
    expectedPolicy?: FirewallPolicyConfig;
    chainId?: number;
    expectedChainId?: number;
    requireProofOfControl?: boolean;
    nowMs?: number;
  }
): {
  valid: boolean;
  reason?: string;
  payload?: ScanAttestationPayload;
} {
  try {
    let raw = '';
    let expectedPayer = maybeExpected?.payer || maybeExpected?.expectedPayer;
    let expectedLinkId = maybeExpected?.linkId || maybeExpected?.expectedLinkId;
    let expectedLinkSigner = maybeExpected?.linkSigner;
    let expectedPolicy = maybeExpected?.policy || maybeExpected?.expectedPolicy;
    let expectedChainId = maybeExpected?.chainId || maybeExpected?.expectedChainId;
    let requireProofOfControl = maybeExpected?.requireProofOfControl;
    let nowMs = maybeExpected?.nowMs;

    if (!attestationOrParams) {
      return { valid: false, reason: 'Missing scan attestation token.' };
    }

    if (typeof attestationOrParams === 'string') {
      raw = attestationOrParams.trim();
    } else {
      raw = (attestationOrParams.attestation || '').trim();
      expectedPayer = attestationOrParams.expectedPayer || expectedPayer;
      expectedLinkId = attestationOrParams.expectedLinkId || expectedLinkId;
      expectedPolicy = attestationOrParams.expectedPolicy || expectedPolicy;
      expectedChainId = attestationOrParams.expectedChainId || expectedChainId;
      nowMs = attestationOrParams.nowMs || nowMs;
    }

    if (!raw) {
      return { valid: false, reason: 'Missing scan attestation token.' };
    }

    const parts = raw.split('.');
    if (parts.length !== 2) {
      return { valid: false, reason: 'Malformed scan attestation token format.' };
    }

    const [encoded, mac] = parts;
    const expectedMac = createHmac('sha256', getAttestationSecret())
      .update(encoded)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const macBuf = Buffer.from(mac, 'utf8');
    const expBuf = Buffer.from(expectedMac, 'utf8');
    if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) {
      return { valid: false, reason: 'Cryptographic HMAC signature mismatch on scan attestation.' };
    }

    const jsonStr = Buffer.from(encoded, 'base64').toString('utf8');
    const payload = JSON.parse(jsonStr) as ScanAttestationPayload;

    const now = nowMs ?? Date.now();
    const expMs = Date.parse(payload.expiresAt);
    if (!Number.isFinite(expMs) || now > expMs) {
      return { valid: false, reason: `Scan attestation expired at ${payload.expiresAt}. Re-scan required.` };
    }

    if (
      expectedPayer &&
      payload.payer.toLowerCase() !== expectedPayer.trim().toLowerCase()
    ) {
      return {
        valid: false,
        reason: `Scan attestation payer mismatch: expected ${expectedPayer}, got ${payload.payer}.`,
      };
    }

    if (
      expectedLinkId &&
      expectedLinkId.trim().toLowerCase() !== 'default' &&
      payload.linkId.toLowerCase() !== expectedLinkId.trim().toLowerCase()
    ) {
      return {
        valid: false,
        reason: `Scan attestation linkId mismatch: expected ${expectedLinkId}, got ${payload.linkId}.`,
      };
    }

    if (
      expectedLinkSigner &&
      payload.linkSigner &&
      payload.linkSigner.toLowerCase() !== expectedLinkSigner.trim().toLowerCase()
    ) {
      return {
        valid: false,
        reason: `Scan attestation linkSigner mismatch: expected ${expectedLinkSigner}, got ${payload.linkSigner}.`,
      };
    }

    if (expectedPolicy) {
      const expectedHash = computeCanonicalPolicyHash(expectedPolicy);
      if (payload.policyHash !== expectedHash) {
        return {
          valid: false,
          reason: 'Scan attestation was generated under a different firewall policy than the active verified payment link.',
        };
      }
    }

    if (
      expectedChainId !== undefined &&
      payload.chainId !== undefined &&
      payload.chainId !== expectedChainId
    ) {
      return {
        valid: false,
        reason: `Scan attestation chainId mismatch: expected ${expectedChainId}, got ${payload.chainId}.`,
      };
    }

    if (requireProofOfControl && !payload.proofOfControl) {
      return {
        valid: false,
        reason:
          'Scan attestation was not backed by a verified Proof of Control signature (proofOfControl=true required).',
      };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'Failed to parse and verify scan attestation.' };
  }
}

// Persistent / Storage-backed link policy registry
export interface RegisteredLinkPolicy {
  linkId: string;
  policy: FirewallPolicyConfig;
  vaultAddress: string;
  signer?: string;
}

const memoryPolicyStore = new Map<string, RegisteredLinkPolicy>();

export function registerVerifiedLinkPolicy(record: RegisteredLinkPolicy): void {
  const key = record.linkId.trim().toLowerCase();
  const enhancedRecord: RegisteredLinkPolicy = {
    ...record,
    signer:
      record.signer ||
      (record.vaultAddress.startsWith('0x') ? record.vaultAddress : undefined),
  };
  memoryPolicyStore.set(key, enhancedRecord);
  void getStorage().set(`policy:${key}`, enhancedRecord, { exSeconds: 86400 * 30 });
}

export function getVerifiedLinkPolicy(linkId: string): RegisteredLinkPolicy {
  const key = linkId.trim().toLowerCase();
  const rec = memoryPolicyStore.get(key);
  if (rec) return rec;

  return {
    linkId,
    policy: AUTHORITATIVE_DEFAULT_POLICY,
    vaultAddress: '',
  };
}

export async function getVerifiedLinkPolicyAsync(linkId: string): Promise<RegisteredLinkPolicy> {
  const key = linkId.trim().toLowerCase();
  const rec = memoryPolicyStore.get(key);
  if (rec) return rec;

  const stored = await getStorage().get<RegisteredLinkPolicy>(`policy:${key}`);
  if (stored) {
    memoryPolicyStore.set(key, stored);
    return stored;
  }

  return {
    linkId,
    policy: AUTHORITATIVE_DEFAULT_POLICY,
    vaultAddress: '',
  };
}

export function clearVerifiedLinkPolicyStoreForTests(): void {
  memoryPolicyStore.clear();
}
