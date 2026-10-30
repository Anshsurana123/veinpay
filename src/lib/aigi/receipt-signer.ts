import crypto from 'node:crypto';

const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex'
);

export const DEFAULT_RECEIPT_KEY_ID = 'veilpay-ed25519-v1';

let activeSigningKey: crypto.KeyObject | null = null;
let activePublicKey: crypto.KeyObject | null = null;

export function assertReceiptSigningKeyConfigured(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.RECEIPT_SIGNING_KEY?.trim()) {
    throw new Error(
      'FATAL: RECEIPT_SIGNING_KEY environment variable is required in production. Refusing to run with insecure default dev key.'
    );
  }
}

function resolveSigningKeys(): {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  keyId: string;
} {
  if (activeSigningKey && activePublicKey) {
    return {
      privateKey: activeSigningKey,
      publicKey: activePublicKey,
      keyId: DEFAULT_RECEIPT_KEY_ID,
    };
  }

  const envKey = process.env.RECEIPT_SIGNING_KEY?.trim();

  let privKey: crypto.KeyObject;
  if (envKey) {
    if (envKey.includes('-----BEGIN')) {
      privKey = crypto.createPrivateKey({ key: envKey });
    } else {
      const cleanHex = envKey.replace(/^0x/i, '');
      const seed = Buffer.from(cleanHex, 'hex');
      const seed32 =
        seed.length === 32
          ? seed
          : crypto.createHash('sha256').update(seed).digest();
      privKey = crypto.createPrivateKey({
        key: Buffer.concat([ED25519_PKCS8_PREFIX, seed32]),
        format: 'der',
        type: 'pkcs8',
      });
    }
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL: RECEIPT_SIGNING_KEY environment variable is required in production. Refusing to run with insecure default dev key.'
      );
    }
    // Deterministic dev/test seed
    const devSeed = crypto
      .createHash('sha256')
      .update('veilpay-default-dev-receipt-signing-key-v1')
      .digest();
    privKey = crypto.createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, devSeed]),
      format: 'der',
      type: 'pkcs8',
    });
  }

  const pubKey = crypto.createPublicKey(privKey);
  activeSigningKey = privKey;
  activePublicKey = pubKey;

  return {
    privateKey: privKey,
    publicKey: pubKey,
    keyId: DEFAULT_RECEIPT_KEY_ID,
  };
}

export function resetKeysForTesting(): void {
  activeSigningKey = null;
  activePublicKey = null;
}

export function signReceiptCommitmentHash(commitmentHash: string): {
  signature: string;
  keyId: string;
} {
  const { privateKey, keyId } = resolveSigningKeys();
  const normalizedHash = commitmentHash.trim().toLowerCase();
  const data = Buffer.from(normalizedHash, 'utf8');

  const sigBuffer = crypto.sign(null, data, privateKey);
  return {
    signature: `0x${sigBuffer.toString('hex')}`,
    keyId,
  };
}

export function verifyReceiptSignature(params: {
  commitmentHash: string;
  signature: string;
  keyId?: string;
}): {
  valid: boolean;
  reason?: string;
} {
  try {
    const { publicKey, keyId } = resolveSigningKeys();

    if (params.keyId && params.keyId !== keyId) {
      return {
        valid: false,
        reason: `Unknown receipt keyId "${params.keyId}". Expected "${keyId}".`,
      };
    }

    const cleanSigHex = (params.signature || '').replace(/^0x/i, '').trim();
    if (!cleanSigHex || cleanSigHex.length !== 128) {
      return {
        valid: false,
        reason: 'Invalid signature length. Expected 64-byte Ed25519 signature.',
      };
    }

    const sigBuffer = Buffer.from(cleanSigHex, 'hex');
    const normalizedHash = params.commitmentHash.trim().toLowerCase();
    const data = Buffer.from(normalizedHash, 'utf8');

    const isValid = crypto.verify(null, data, publicKey, sigBuffer);
    return {
      valid: isValid,
      reason: isValid ? undefined : 'Ed25519 cryptographic signature verification failed.',
    };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'Signature verification failed',
    };
  }
}

export function getReceiptPublicKeyInfo(): {
  keyId: string;
  algorithm: string;
  publicKeyHex: string;
  publicKeyPem: string;
  jwk: {
    kty: string;
    crv: string;
    kid: string;
    x: string;
  };
} {
  const { publicKey, keyId } = resolveSigningKeys();
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = spkiDer.subarray(spkiDer.length - 32);

  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const base64UrlX = rawPub
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return {
    keyId,
    algorithm: 'Ed25519',
    publicKeyHex: `0x${rawPub.toString('hex')}`,
    publicKeyPem: pem,
    jwk: {
      kty: 'OKP',
      crv: 'Ed25519',
      kid: keyId,
      x: base64UrlX,
    },
  };
}
