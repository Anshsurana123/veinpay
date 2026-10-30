import crypto from 'node:crypto';

const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex'
);

export const DEFAULT_RECEIPT_KEY_ID = 'veilpay-ed25519-v1';
export const DEMO_RECEIPT_KEY_ID = 'veilpay-demo-ed25519';

interface KeyPairEntry {
  keyId: string;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  isDemo: boolean;
}

let keyRegistry: Map<string, KeyPairEntry> | null = null;
let activeKeyId: string = DEFAULT_RECEIPT_KEY_ID;

export function assertReceiptSigningKeyConfigured(): void {
  const allowDev = process.env.VEILPAY_ALLOW_DEV_SECRETS === 'true';
  const hasKeys =
    Boolean(process.env.RECEIPT_SIGNING_KEYS?.trim()) ||
    Boolean(process.env.RECEIPT_SIGNING_KEY?.trim());

  if (process.env.NODE_ENV === 'production' && !hasKeys && !allowDev) {
    throw new Error(
      'RECEIPT_SIGNING_KEY environment variable is required in production.'
    );
  }
}

function parsePrivateKeyFromString(keyStr: string): crypto.KeyObject {
  if (keyStr.includes('-----BEGIN')) {
    return crypto.createPrivateKey({ key: keyStr });
  }
  const cleanHex = keyStr.replace(/^0x/i, '').trim();
  const seed = Buffer.from(cleanHex, 'hex');
  const seed32 =
    seed.length === 32
      ? seed
      : crypto.createHash('sha256').update(seed).digest();
  return crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed32]),
    format: 'der',
    type: 'pkcs8',
  });
}

function initKeyRegistry(): Map<string, KeyPairEntry> {
  if (keyRegistry) return keyRegistry;

  const registry = new Map<string, KeyPairEntry>();

  // 1. Check if multiple keys are provided via RECEIPT_SIGNING_KEYS
  const multiJson = process.env.RECEIPT_SIGNING_KEYS?.trim();
  if (multiJson) {
    try {
      const parsed = JSON.parse(multiJson) as Record<string, string>;
      for (const [kId, kVal] of Object.entries(parsed)) {
        if (kVal && typeof kVal === 'string') {
          const priv = parsePrivateKeyFromString(kVal);
          const pub = crypto.createPublicKey(priv);
          registry.set(kId, {
            keyId: kId,
            privateKey: priv,
            publicKey: pub,
            isDemo: false,
          });
        }
      }
    } catch {
      // Invalid JSON fallback
    }
  }

  // 2. Load primary RECEIPT_SIGNING_KEY
  const singleKey = process.env.RECEIPT_SIGNING_KEY?.trim();
  const chosenKeyId =
    process.env.RECEIPT_ACTIVE_KEY_ID?.trim() || DEFAULT_RECEIPT_KEY_ID;

  if (singleKey) {
    const priv = parsePrivateKeyFromString(singleKey);
    const pub = crypto.createPublicKey(priv);
    registry.set(chosenKeyId, {
      keyId: chosenKeyId,
      privateKey: priv,
      publicKey: pub,
      isDemo: false,
    });
    activeKeyId = chosenKeyId;
  } else if (registry.size === 0) {
    // Deterministic dev/test seed
    const devSeed = crypto
      .createHash('sha256')
      .update('veilpay-default-dev-receipt-signing-key-v1')
      .digest();
    const priv = crypto.createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, devSeed]),
      format: 'der',
      type: 'pkcs8',
    });
    const pub = crypto.createPublicKey(priv);
    registry.set(DEFAULT_RECEIPT_KEY_ID, {
      keyId: DEFAULT_RECEIPT_KEY_ID,
      privateKey: priv,
      publicKey: pub,
      isDemo: false,
    });
    activeKeyId = DEFAULT_RECEIPT_KEY_ID;
  } else {
    // If multiJson had keys, select the first or configured one
    activeKeyId = process.env.RECEIPT_ACTIVE_KEY_ID?.trim() || registry.keys().next().value!;
  }

  // 3. Register separate DEMO key
  const demoSeed = crypto
    .createHash('sha256')
    .update('veilpay-demo-unverified-signing-key-2026')
    .digest();
  const demoPriv = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, demoSeed]),
    format: 'der',
    type: 'pkcs8',
  });
  const demoPub = crypto.createPublicKey(demoPriv);
  registry.set(DEMO_RECEIPT_KEY_ID, {
    keyId: DEMO_RECEIPT_KEY_ID,
    privateKey: demoPriv,
    publicKey: demoPub,
    isDemo: true,
  });

  keyRegistry = registry;
  return registry;
}

export function resetKeysForTesting(): void {
  keyRegistry = null;
  activeKeyId = DEFAULT_RECEIPT_KEY_ID;
}

export function isDemoKey(keyId: string): boolean {
  return keyId === DEMO_RECEIPT_KEY_ID;
}

export function signReceiptCommitmentHash(
  commitmentHash: string,
  options?: { useDemoKey?: boolean; keyId?: string }
): {
  signature: string;
  keyId: string;
} {
  const reg = initKeyRegistry();
  const targetKeyId = options?.useDemoKey
    ? DEMO_RECEIPT_KEY_ID
    : options?.keyId || activeKeyId;

  const entry = reg.get(targetKeyId) || reg.get(activeKeyId)!;
  const normalizedHash = commitmentHash.trim().toLowerCase();
  const data = Buffer.from(normalizedHash, 'utf8');

  const sigBuffer = crypto.sign(null, data, entry.privateKey);
  return {
    signature: `0x${sigBuffer.toString('hex')}`,
    keyId: entry.keyId,
  };
}

export function verifyReceiptSignature(params: {
  commitmentHash: string;
  signature: string;
  keyId?: string;
}): {
  valid: boolean;
  isDemo?: boolean;
  reason?: string;
} {
  try {
    const reg = initKeyRegistry();
    const kId = params.keyId || activeKeyId;
    const entry = reg.get(kId);

    if (!entry) {
      return {
        valid: false,
        reason: `Unknown receipt keyId "${params.keyId}". No matching public key registered.`,
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

    const isValid = crypto.verify(null, data, entry.publicKey, sigBuffer);
    return {
      valid: isValid,
      isDemo: entry.isDemo,
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
  const reg = initKeyRegistry();
  const entry = reg.get(activeKeyId) || reg.values().next().value!;
  const spkiDer = entry.publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = spkiDer.subarray(spkiDer.length - 32);
  const pem = entry.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const base64UrlX = rawPub
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return {
    keyId: entry.keyId,
    algorithm: 'Ed25519',
    publicKeyHex: `0x${rawPub.toString('hex')}`,
    publicKeyPem: pem,
    jwk: {
      kty: 'OKP',
      crv: 'Ed25519',
      kid: entry.keyId,
      x: base64UrlX,
    },
  };
}

export function getAllReceiptPublicKeys(): Array<{
  keyId: string;
  algorithm: string;
  publicKeyHex: string;
  isDemo: boolean;
  jwk: {
    kty: string;
    crv: string;
    kid: string;
    x: string;
  };
}> {
  const reg = initKeyRegistry();
  const keys: Array<ReturnType<typeof getAllReceiptPublicKeys>[0]> = [];

  for (const entry of reg.values()) {
    const spkiDer = entry.publicKey.export({ type: 'spki', format: 'der' });
    const rawPub = spkiDer.subarray(spkiDer.length - 32);
    const base64UrlX = rawPub
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    keys.push({
      keyId: entry.keyId,
      algorithm: 'Ed25519',
      publicKeyHex: `0x${rawPub.toString('hex')}`,
      isDemo: entry.isDemo,
      jwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        kid: entry.keyId,
        x: base64UrlX,
      },
    });
  }

  return keys;
}
