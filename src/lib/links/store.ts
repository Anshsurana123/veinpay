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
  revoked: boolean;
  revokedAt?: string;
  createdAt: string;
}

const MAX_STORED_LINKS = 5000;
const linkRecordById = new Map<string, StoredPaymentLinkRecord>();
const linkRecordByHandle = new Map<string, StoredPaymentLinkRecord>();
const revokedLinkSet = new Map<string, { revokedAt: string; signer: string }>();

function pruneStoreIfNeeded(): void {
  if (linkRecordById.size > MAX_STORED_LINKS) {
    const oldestKey = linkRecordById.keys().next().value;
    if (oldestKey) {
      const rec = linkRecordById.get(oldestKey);
      linkRecordById.delete(oldestKey);
      if (rec) {
        linkRecordByHandle.delete(rec.handle.toLowerCase());
      }
    }
  }
}

export function storeSignedLinkRecord(params: {
  payload: SignedPaymentLinkPayload;
  encodedPayload: string;
  signature: `0x${string}`;
  trustLevel: LinkTrustLevel;
}): {
  record: StoredPaymentLinkRecord;
} {
  const key = params.payload.linkId.trim().toLowerCase();
  const handleKey = params.payload.handle.trim().toLowerCase();
  const incomingSigner = params.payload.signer.trim().toLowerCase();

  // Prevent linkId and handle hijacking: First-write-wins per signer
  const existingById = linkRecordById.get(key);
  if (
    existingById &&
    existingById.payload.signer.trim().toLowerCase() !== incomingSigner
  ) {
    throw new Error(
      `LINK_ID_COLLISION_DIFFERENT_SIGNER: Link ID "${key}" is already registered by a different signer wallet (${existingById.payload.signer}).`
    );
  }

  const existingByHandle = linkRecordByHandle.get(handleKey);
  if (
    existingByHandle &&
    existingByHandle.payload.signer.trim().toLowerCase() !== incomingSigner
  ) {
    throw new Error(
      `HANDLE_COLLISION_DIFFERENT_SIGNER: Handle "${handleKey}" is already owned by a different signer wallet (${existingByHandle.payload.signer}).`
    );
  }

  pruneStoreIfNeeded();

  const existingRevocation = revokedLinkSet.get(key);

  const record: StoredPaymentLinkRecord = {
    linkId: key,
    handle: params.payload.handle.trim(),
    payload: params.payload,
    encodedPayload: params.encodedPayload,
    signature: params.signature,
    trustLevel: params.trustLevel,
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
      signer: params.payload.signer,
    });
    registerVerifiedLinkPolicy({
      linkId: params.payload.handle.trim(),
      policy: params.payload.policy,
      vaultAddress: params.payload.vaultAddress,
      signer: params.payload.signer,
    });
  }

  return {
    record,
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
