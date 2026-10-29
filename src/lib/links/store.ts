import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type {
  LinkTrustLevel,
  SignedPaymentLinkPayload,
} from '@/types/veilpay';
import { registerVerifiedLinkPolicy } from '@/lib/security/attestation';

export interface StoredPaymentLinkRecord {
  linkId: string;
  handle: string;
  payload: SignedPaymentLinkPayload;
  encodedPayload: string;
  signature: `0x${string}`;
  trustLevel: LinkTrustLevel;
  manageTokenHash: string;
  revoked: boolean;
  revokedAt?: string;
  createdAt: string;
}

const linkRecordById = new Map<string, StoredPaymentLinkRecord>();
const linkRecordByHandle = new Map<string, StoredPaymentLinkRecord>();
const revokedLinkSet = new Map<string, { revokedAt: string; signer: string }>();

export function hashManageToken(token: string): string {
  return createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}

export function generateManageToken(): {
  manageToken: string;
  manageTokenHash: string;
} {
  const manageToken = `vpm_${randomBytes(24).toString('base64url')}`;
  return {
    manageToken,
    manageTokenHash: hashManageToken(manageToken),
  };
}

export function verifyManageTokenForLink(
  linkId: string,
  candidateToken: string | null | undefined
): boolean {
  if (!candidateToken || typeof candidateToken !== 'string') return false;
  const rec = getStoredLinkRecord(linkId);
  if (!rec) return false;
  const candidateHash = hashManageToken(candidateToken);
  const a = Buffer.from(candidateHash, 'utf8');
  const b = Buffer.from(rec.manageTokenHash, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function storeSignedLinkRecord(params: {
  payload: SignedPaymentLinkPayload;
  encodedPayload: string;
  signature: `0x${string}`;
  trustLevel: LinkTrustLevel;
  manageTokenHash?: string;
}): {
  record: StoredPaymentLinkRecord;
  manageToken?: string;
} {
  const key = params.payload.linkId.trim().toLowerCase();
  const handleKey = params.payload.handle.trim().toLowerCase();
  const generated = params.manageTokenHash
    ? { manageToken: undefined, manageTokenHash: params.manageTokenHash }
    : generateManageToken();

  const existingRevocation = revokedLinkSet.get(key);

  const record: StoredPaymentLinkRecord = {
    linkId: key,
    handle: params.payload.handle.trim(),
    payload: params.payload,
    encodedPayload: params.encodedPayload,
    signature: params.signature,
    trustLevel: params.trustLevel,
    manageTokenHash: generated.manageTokenHash,
    revoked: Boolean(existingRevocation),
    revokedAt: existingRevocation?.revokedAt,
    createdAt: params.payload.createdAt,
  };

  linkRecordById.set(key, record);
  linkRecordByHandle.set(handleKey, record);

  if (!record.revoked) {
    registerVerifiedLinkPolicy({
      linkId: key,
      policy: params.payload.policy,
      vaultAddress: params.payload.vaultAddress,
    });
    registerVerifiedLinkPolicy({
      linkId: params.payload.handle.trim(),
      policy: params.payload.policy,
      vaultAddress: params.payload.vaultAddress,
    });
  }

  return {
    record,
    manageToken: generated.manageToken,
  };
}

export function getStoredLinkRecord(
  linkIdOrHandle: string | null | undefined
): StoredPaymentLinkRecord | null {
  if (!linkIdOrHandle) return null;
  const key = linkIdOrHandle.trim().toLowerCase();
  return linkRecordById.get(key) ?? linkRecordByHandle.get(key) ?? null;
}

export function markLinkRevoked(params: {
  linkId: string;
  signer: string;
  issuedAt: string;
}): void {
  const key = params.linkId.trim().toLowerCase();
  revokedLinkSet.set(key, {
    revokedAt: params.issuedAt,
    signer: params.signer.toLowerCase(),
  });
  const existing = linkRecordById.get(key);
  if (existing) {
    existing.revoked = true;
    existing.revokedAt = params.issuedAt;
  }
}

export function isLinkRevoked(linkId: string | null | undefined): boolean {
  if (!linkId) return false;
  const key = linkId.trim().toLowerCase();
  if (revokedLinkSet.has(key)) return true;
  const rec = getStoredLinkRecord(key);
  return Boolean(rec?.revoked);
}

export function clearLinkStoreForTests(): void {
  linkRecordById.clear();
  linkRecordByHandle.clear();
  revokedLinkSet.clear();
}
