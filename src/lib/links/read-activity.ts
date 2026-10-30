import { randomBytes } from 'crypto';
import { getAddress, isAddress, verifyTypedData } from 'viem';

export const READ_ACTIVITY_EIP712_DOMAIN = {
  name: 'VeinPay Link Activity',
  version: '1',
} as const;

export const READ_ACTIVITY_EIP712_TYPES = {
  ReadActivity: [
    { name: 'linkId', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const;

export interface ReadActivityChallenge {
  linkId: string;
  nonce: string;
  expiresAt: string;
  expiresAtSec: number;
}

const readActivityChallengeStore = new Map<
  string,
  {
    linkId: string;
    expiresAtSec: number;
    consumed: boolean;
  }
>();

export function issueReadActivityChallenge(
  linkId: string,
  ttlSeconds = 300
): ReadActivityChallenge {
  const nonce = `0x${randomBytes(16).toString('hex')}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAtSec = nowSec + ttlSeconds;

  readActivityChallengeStore.set(nonce, {
    linkId: linkId.trim().toLowerCase(),
    expiresAtSec,
    consumed: false,
  });

  return {
    linkId: linkId.trim(),
    nonce,
    expiresAt: expiresAtSec.toString(),
    expiresAtSec,
  };
}

export function buildReadActivityTypedData(params: {
  linkId: string;
  nonce: string;
  expiresAt: string | number | bigint;
}) {
  return {
    domain: READ_ACTIVITY_EIP712_DOMAIN,
    types: READ_ACTIVITY_EIP712_TYPES,
    primaryType: 'ReadActivity' as const,
    message: {
      linkId: params.linkId.trim().toLowerCase(),
      nonce: params.nonce.trim(),
      expiresAt: BigInt(params.expiresAt),
    },
  };
}

export async function verifyReadActivitySignature(params: {
  linkId: string;
  nonce: string;
  expiresAt: string | number | bigint;
  signature: `0x${string}`;
  expectedSigner: string;
  requireStoredNonce?: boolean;
}): Promise<{
  valid: boolean;
  reason?: string;
}> {
  const expectedAddr = params.expectedSigner.trim();
  if (!isAddress(expectedAddr, { strict: false })) {
    return { valid: false, reason: 'Invalid expected link signer address.' };
  }
  const checksumSigner = getAddress(expectedAddr);

  const expiresAtSec = Number(params.expiresAt);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expiresAtSec) || nowSec > expiresAtSec) {
    return { valid: false, reason: 'ReadActivity challenge has expired.' };
  }

  const requireNonce = params.requireStoredNonce ?? true;
  if (requireNonce) {
    const stored = readActivityChallengeStore.get(params.nonce);
    if (!stored) {
      return { valid: false, reason: 'Unknown or expired ReadActivity nonce.' };
    }
    if (stored.consumed) {
      return { valid: false, reason: 'ReadActivity nonce has already been consumed.' };
    }
    if (stored.linkId !== params.linkId.trim().toLowerCase()) {
      return { valid: false, reason: 'ReadActivity nonce linkId mismatch.' };
    }
  }

  const typedData = buildReadActivityTypedData(params);
  let signerValid = false;
  try {
    signerValid = await verifyTypedData({
      address: checksumSigner,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: params.signature,
    });
  } catch {
    signerValid = false;
  }

  if (!signerValid) {
    return {
      valid: false,
      reason: 'ReadActivity signature does not match link signer.',
    };
  }

  if (requireNonce) {
    const stored = readActivityChallengeStore.get(params.nonce);
    if (stored) {
      stored.consumed = true;
    }
  }

  return { valid: true };
}

export function clearReadActivityStoreForTests(): void {
  readActivityChallengeStore.clear();
}
