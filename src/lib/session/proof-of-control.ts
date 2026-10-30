import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { getStorage } from '@/lib/storage';

export interface ProofOfControlChallenge {
  nonce: string;
  linkId: string;
  vaultAddress: string;
  scannedAddress: `0x${string}`;
  chainId: number;
  issuedAt: string;
  expiresAt: string;
  message: string;
}

export interface ProofOfControlTokenPayload {
  nonce: string;
  linkId: string;
  vaultAddress: string;
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

export function assertSessionSecretConfigured(): void {
  const secret = process.env.VEILPAY_SESSION_SECRET?.trim();
  const allowDev = process.env.VEILPAY_ALLOW_DEV_SECRETS === 'true';
  if (process.env.NODE_ENV === 'production' && !secret && !allowDev) {
    throw new Error(
      'FATAL: VEILPAY_SESSION_SECRET is required in production.'
    );
  }
}

function getSessionSecret(): string {
  const secret = process.env.VEILPAY_SESSION_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && process.env.VEILPAY_ALLOW_DEV_SECRETS !== 'true') {
      throw new Error(
        'FATAL: VEILPAY_SESSION_SECRET is required in production.'
      );
    }
    return 'veilpay-dev-ephemeral-session-hmac-secret-2026';
  }
  return secret;
}

export function buildProofOfControlMessage(params: {
  nonce: string;
  linkId: string;
  vaultAddress?: string;
  scannedAddress: string;
  chainId: number;
  expiresAt: string;
}): string {
  const normalizedAddr = params.scannedAddress.trim().toLowerCase();
  const normalizedVault = (params.vaultAddress ?? '').trim().toLowerCase();
  const lines = [
    'VeilPay Pre-Sign Firewall — Proof of Wallet Control',
    `Link ID: ${params.linkId.trim()}`,
  ];
  if (normalizedVault) {
    lines.push(`Vault Address: ${normalizedVault}`);
  }
  lines.push(
    `Scanned Wallet: ${normalizedAddr}`,
    `Origin Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce.trim()}`,
    `Expires At: ${params.expiresAt.trim()}`
  );
  return lines.join('\n');
}

export function issueProofOfControlNonce(params: {
  linkId: string;
  vaultAddress?: string;
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
  const vaultAddress = (params.vaultAddress ?? '').trim();
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
    vaultAddress,
    scannedAddress: checksumAddr,
    chainId,
    expiresAt,
  });

  const challenge: ProofOfControlChallenge = {
    nonce,
    linkId,
    vaultAddress,
    scannedAddress: checksumAddr,
    chainId,
    issuedAt,
    expiresAt,
    message,
  };

  nonceStore.set(nonce, { ...challenge, consumed: false });
  // Store in distributed storage with TTL (seconds)
  void getStorage().set(
    `poc:nonce:${nonce}`,
    { ...challenge, consumed: false },
    { exSeconds: Math.ceil(ttl / 1000) }
  );

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
    vaultAddress: (payload.vaultAddress || '').toLowerCase(),
  });
  const encoded = Buffer.from(canonicalJson, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const mac = createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${encoded}.${mac}`;
}

export function verifyProofOfControlToken(
  token: string | null | undefined,
  expected: {
    scannedAddress: string;
    vaultAddress?: string;
    linkId?: string;
    chainId?: number;
    nowMs?: number;
  }
): {
  valid: boolean;
  reason?: string;
  payload?: ProofOfControlTokenPayload;
} {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Missing proofOfControlToken.' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Malformed proofOfControlToken format.' };
  }

  const [encoded, mac] = parts;
  const expectedMac = createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const macBuf = Buffer.from(mac, 'utf8');
  const expBuf = Buffer.from(expectedMac, 'utf8');
  if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) {
    return { valid: false, reason: 'HMAC signature mismatch on proofOfControlToken.' };
  }

  try {
    const jsonStr = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr) as ProofOfControlTokenPayload;

    if (!parsed || parsed.proofOfControl !== true) {
      return { valid: false, reason: 'Invalid token payload.' };
    }

    const now = expected.nowMs ?? Date.now();
    const expMs = Date.parse(parsed.expiresAt);
    if (!Number.isFinite(expMs) || now > expMs) {
      return { valid: false, reason: 'Proof of control token has expired.' };
    }

    const expectedAddr = expected.scannedAddress.trim().toLowerCase();
    if (parsed.scannedAddress.toLowerCase() !== expectedAddr) {
      return {
        valid: false,
        reason: `Proof of control was signed by ${parsed.scannedAddress}, but scanned wallet is ${expectedAddr}.`,
      };
    }

    if (
      expected.vaultAddress &&
      parsed.vaultAddress &&
      parsed.vaultAddress.toLowerCase() !== expected.vaultAddress.trim().toLowerCase()
    ) {
      return {
        valid: false,
        reason: `Proof of control vault address (${parsed.vaultAddress}) does not match expected destination vault (${expected.vaultAddress}).`,
      };
    }

    if (
      expected.linkId &&
      expected.linkId.trim() !== 'default' &&
      parsed.linkId !== expected.linkId.trim()
    ) {
      return {
        valid: false,
        reason: `Proof of control was issued for linkId "${parsed.linkId}", but active link is "${expected.linkId}".`,
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
  vaultAddress?: string;
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

  let effectiveVaultAddress = (params.vaultAddress ?? '').trim();
  const requireNonce = params.requireStoredNonce ?? true;
  if (requireNonce) {
    // Atomically consume from storage via GETDEL
    const storage = getStorage();
    const storageStored = await storage.getdel<ProofOfControlChallenge & { consumed: boolean }>(
      `poc:nonce:${params.nonce}`
    );
    const inMemStored = nonceStore.get(params.nonce);

    const stored = storageStored || inMemStored;
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

    // Mark in-memory consumed as well to prevent any concurrent reuse
    if (inMemStored) {
      inMemStored.consumed = true;
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
    if (!effectiveVaultAddress && stored.vaultAddress) {
      effectiveVaultAddress = stored.vaultAddress;
    }
  }

  const message = buildProofOfControlMessage({
    nonce: params.nonce,
    linkId: params.linkId,
    vaultAddress: effectiveVaultAddress,
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

    const payload: ProofOfControlTokenPayload = {
      nonce: params.nonce,
      linkId: params.linkId.trim(),
      vaultAddress: effectiveVaultAddress,
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
  if (params.activePersonaId !== 'reown-connected') {
    return {
      canQuote: false,
      canBroadcast: false,
      isScanOnly: true,
      reason:
        'Preset personas and pasted addresses are scan-only. Connect the wallet in Reown AppKit and sign Proof of Control to unlock quotes and broadcasting.',
    };
  }

  if (!areAddressesMatchingSigner(params.connectedAddress, params.scannedAddress)) {
    return {
      canQuote: false,
      canBroadcast: false,
      isScanOnly: true,
      reason:
        'Connected wallet does not match the scanned payer address. Switch to the scanned wallet to request a quote or broadcast.',
    };
  }

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
