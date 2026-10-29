import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getAddress, isAddress, verifyMessage } from 'viem';

export interface ProofOfControlChallenge {
  nonce: string;
  linkId: string;
  scannedAddress: `0x${string}`;
  chainId: number;
  issuedAt: string;
  expiresAt: string;
  message: string;
}

export interface ProofOfControlTokenPayload {
  nonce: string;
  linkId: string;
  scannedAddress: string;
  chainId: number;
  expiresAt: string;
  proofOfControl: true;
}

const DEFAULT_NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const nonceStore = new Map<
  string,
  ProofOfControlChallenge & { consumed: boolean }
>();

function getSessionSecret(): string {
  return (
    process.env.VEILPAY_SESSION_SECRET?.trim() ||
    process.env.RECEIPT_SIGNING_KEY?.trim() ||
    'veilpay-dev-ephemeral-session-hmac-secret-2026'
  );
}

export function buildProofOfControlMessage(params: {
  nonce: string;
  linkId: string;
  scannedAddress: string;
  chainId: number;
  expiresAt: string;
}): string {
  const normalizedAddr = params.scannedAddress.trim().toLowerCase();
  return [
    'VeilPay Pre-Sign Firewall — Proof of Wallet Control',
    `Link ID: ${params.linkId.trim()}`,
    `Scanned Wallet: ${normalizedAddr}`,
    `Origin Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce.trim()}`,
    `Expires At: ${params.expiresAt.trim()}`,
  ].join('\n');
}

export function issueProofOfControlNonce(params: {
  linkId: string;
  scannedAddress: string;
  chainId: number;
  ttlMs?: number;
  nowMs?: number;
}): ProofOfControlChallenge {
  const trimmedAddr = params.scannedAddress.trim();
  if (!isAddress(trimmedAddr, { strict: false })) {
    throw new Error(`Invalid EVM scannedAddress: "${params.scannedAddress}"`);
  }
  const checksumAddr = getAddress(trimmedAddr);
  const linkId = params.linkId.trim() || 'default';
  const chainId = Number(params.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid chainId for proof of control: ${params.chainId}`);
  }

  const now = params.nowMs ?? Date.now();
  const ttl = params.ttlMs ?? DEFAULT_NONCE_TTL_MS;
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttl).toISOString();
  const nonce = `0x${randomBytes(16).toString('hex')}`;

  const message = buildProofOfControlMessage({
    nonce,
    linkId,
    scannedAddress: checksumAddr,
    chainId,
    expiresAt,
  });

  const challenge: ProofOfControlChallenge = {
    nonce,
    linkId,
    scannedAddress: checksumAddr,
    chainId,
    issuedAt,
    expiresAt,
    message,
  };

  nonceStore.set(nonce, { ...challenge, consumed: false });
  return challenge;
}

export function signProofOfControlToken(
  payload: ProofOfControlTokenPayload
): string {
  const canonicalJson = JSON.stringify({
    chainId: payload.chainId,
    expiresAt: payload.expiresAt,
    linkId: payload.linkId,
    nonce: payload.nonce,
    proofOfControl: true,
    scannedAddress: payload.scannedAddress.toLowerCase(),
  });
  const encoded = Buffer.from(canonicalJson, 'utf8').toString('base64url');
  const mac = createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${mac}`;
}

export function verifyProofOfControlToken(
  token: string | null | undefined,
  expected: {
    scannedAddress: string;
    linkId?: string;
    chainId?: number;
    nowMs?: number;
  }
): {
  valid: boolean;
  reason?: string;
  payload?: ProofOfControlTokenPayload;
} {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'Missing or malformed proofOfControlToken.' };
  }

  const [encoded, mac] = token.split('.');
  if (!encoded || !mac) {
    return { valid: false, reason: 'Malformed proofOfControlToken segments.' };
  }

  const expectedMac = createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const macBuf = Buffer.from(mac, 'utf8');
  const expBuf = Buffer.from(expectedMac, 'utf8');
  if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) {
    return { valid: false, reason: 'Invalid proofOfControlToken HMAC signature.' };
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as ProofOfControlTokenPayload;

    if (parsed.proofOfControl !== true) {
      return { valid: false, reason: 'Token does not grant proofOfControl.' };
    }

    const now = expected.nowMs ?? Date.now();
    const expMs = Date.parse(parsed.expiresAt);
    if (!Number.isFinite(expMs) || now > expMs) {
      return { valid: false, reason: 'Proof of control token has expired.' };
    }

    if (
      parsed.scannedAddress.toLowerCase() !==
      expected.scannedAddress.trim().toLowerCase()
    ) {
      return {
        valid: false,
        reason: `Proof of control signer (${parsed.scannedAddress}) does not match scanned wallet (${expected.scannedAddress}).`,
      };
    }

    if (
      expected.linkId &&
      parsed.linkId !== expected.linkId.trim()
    ) {
      return {
        valid: false,
        reason: `Proof of control linkId (${parsed.linkId}) does not match active link (${expected.linkId}).`,
      };
    }

    if (
      expected.chainId !== undefined &&
      Number(parsed.chainId) !== Number(expected.chainId)
    ) {
      return {
        valid: false,
        reason: `Proof of control chainId (${parsed.chainId}) does not match origin chainId (${expected.chainId}).`,
      };
    }

    return { valid: true, payload: parsed };
  } catch {
    return { valid: false, reason: 'Failed to decode proofOfControlToken payload.' };
  }
}

export async function verifyProofOfControlSignature(params: {
  nonce: string;
  linkId: string;
  scannedAddress: string;
  chainId: number;
  expiresAt: string;
  signature: `0x${string}`;
  requireStoredNonce?: boolean;
  nowMs?: number;
}): Promise<{
  valid: boolean;
  token?: string;
  reason?: string;
  payload?: ProofOfControlTokenPayload;
}> {
  const trimmedAddr = params.scannedAddress.trim();
  if (!isAddress(trimmedAddr, { strict: false })) {
    return { valid: false, reason: 'Invalid EVM scannedAddress.' };
  }

  const checksumAddr = getAddress(trimmedAddr);
  const now = params.nowMs ?? Date.now();
  const expMs = Date.parse(params.expiresAt);
  if (!Number.isFinite(expMs) || now > expMs) {
    return { valid: false, reason: 'Proof of control challenge has expired.' };
  }

  const requireNonce = params.requireStoredNonce ?? true;
  if (requireNonce) {
    const stored = nonceStore.get(params.nonce);
    if (!stored) {
      return {
        valid: false,
        reason: 'Unknown or expired proof-of-control nonce.',
      };
    }
    if (stored.consumed) {
      return {
        valid: false,
        reason: 'Proof-of-control nonce has already been used.',
      };
    }
    if (
      stored.scannedAddress.toLowerCase() !== checksumAddr.toLowerCase() ||
      stored.linkId !== params.linkId.trim() ||
      stored.chainId !== Number(params.chainId) ||
      stored.expiresAt !== params.expiresAt.trim()
    ) {
      return {
        valid: false,
        reason: 'Challenge parameters do not match issued nonce record.',
      };
    }
  }

  const message = buildProofOfControlMessage({
    nonce: params.nonce,
    linkId: params.linkId,
    scannedAddress: checksumAddr,
    chainId: Number(params.chainId),
    expiresAt: params.expiresAt,
  });

  try {
    const verified = await verifyMessage({
      address: checksumAddr,
      message,
      signature: params.signature,
    });

    if (!verified) {
      return {
        valid: false,
        reason: 'Signature verification failed: signer does not match scannedAddress.',
      };
    }

    if (requireNonce) {
      const stored = nonceStore.get(params.nonce);
      if (stored) {
        stored.consumed = true;
      }
    }

    const payload: ProofOfControlTokenPayload = {
      nonce: params.nonce,
      linkId: params.linkId.trim(),
      scannedAddress: checksumAddr.toLowerCase(),
      chainId: Number(params.chainId),
      expiresAt: params.expiresAt.trim(),
      proofOfControl: true,
    };

    const token = signProofOfControlToken(payload);
    return { valid: true, token, payload };
  } catch (err) {
    return {
      valid: false,
      reason:
        err instanceof Error
          ? `Signature verification failed: ${err.message}`
          : 'Signature verification failed.',
    };
  }
}

export function areAddressesMatchingSigner(
  connectedAddress?: string | null,
  scannedAddress?: string | null
): boolean {
  if (!connectedAddress || !scannedAddress) return false;
  const a = connectedAddress.trim().toLowerCase();
  const b = scannedAddress.trim().toLowerCase();
  if (!isAddress(a, { strict: false }) || !isAddress(b, { strict: false })) {
    return false;
  }
  return a === b;
}

export function evaluatePayerQuoteAndBroadcastEligibility(params: {
  activePersonaId: string;
  connectedAddress?: string | null;
  scannedAddress?: string | null;
  proofOfControlToken?: string | null;
}): {
  canQuote: boolean;
  canBroadcast: boolean;
  isScanOnly: boolean;
  reason?: string;
} {
  // Rule 2(c): Personas and pasted addresses stay scan-only: they can see results
  // but never get a quote or broadcast.
  if (params.activePersonaId !== 'reown-connected') {
    return {
      canQuote: false,
      canBroadcast: false,
      isScanOnly: true,
      reason:
        'Preset personas and pasted addresses are scan-only. Connect the wallet in Reown AppKit and sign Proof of Control to unlock quotes and broadcasting.',
    };
  }

  // Rule 2(a): Connected wallet must equal scanned wallet (case-insensitive)
  if (!areAddressesMatchingSigner(params.connectedAddress, params.scannedAddress)) {
    return {
      canQuote: false,
      canBroadcast: false,
      isScanOnly: true,
      reason:
        'Connected wallet does not match the scanned payer address. Switch to the scanned wallet to request a quote or broadcast.',
    };
  }

  // Rule 2(b): Proof of control token must be present and valid for the scanned wallet
  if (!params.proofOfControlToken) {
    return {
      canQuote: false,
      canBroadcast: false,
      isScanOnly: true,
      reason:
        'Proof of Control signature required: sign the wallet ownership challenge to bind your connected signer to the scanned address.',
    };
  }

  return {
    canQuote: true,
    canBroadcast: true,
    isScanOnly: false,
  };
}

export function clearProofOfControlStoreForTests(): void {
  nonceStore.clear();
}
