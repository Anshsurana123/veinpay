import type {
  LinkTrustLevel,
  SignedPaymentLinkPayload,
} from '@/types/veilpay';
import { registerVerifiedLinkPolicy } from '@/lib/security/attestation';
import { getStorage } from '@/lib/storage';

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
  handleStatus?: 'OWNED' | 'NOT_OWNED_BY_SIGNER';
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
  allowHandleCollision?: boolean;
}): {
  record: StoredPaymentLinkRecord;
  handleCollision?: boolean;
  handleOwner?: string;
} {
  const key = params.payload.linkId.trim().toLowerCase();
  const handleKey = params.payload.handle.trim().toLowerCase();
  const incomingSigner = params.payload.signer.trim().toLowerCase();

  // Prevent linkId hijacking: First-write-wins per signer
  const existingById = linkRecordById.get(key);
  if (
    existingById &&
    existingById.payload.signer.trim().toLowerCase() !== incomingSigner
  ) {
    throw new Error(
      `LINK_ID_COLLISION_DIFFERENT_SIGNER: Link ID "${key}" is already registered by a different signer wallet (${existingById.payload.signer}).`
    );
  }

  // Handle collision check
  let handleCollision = false;
  let handleOwner: string | undefined = undefined;
  const existingByHandle = linkRecordByHandle.get(handleKey);
  if (
    existingByHandle &&
    existingByHandle.payload.signer.trim().toLowerCase() !== incomingSigner
  ) {
    handleCollision = true;
    handleOwner = existingByHandle.payload.signer;
    if (!params.allowHandleCollision) {
      throw new Error(
        `HANDLE_COLLISION_DIFFERENT_SIGNER: Handle "${handleKey}" is already owned by a different signer wallet (${existingByHandle.payload.signer}).`
      );
    }
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
    handleStatus: handleCollision ? 'NOT_OWNED_BY_SIGNER' : 'OWNED',
  };

  linkRecordById.set(key, record);
  if (!handleCollision) {
    linkRecordByHandle.set(handleKey, record);
  }

  // Persist asynchronously to storage
  const storage = getStorage();
  void storage.set(`link:${key}`, record, { exSeconds: 86400 * 90 });
  if (!handleCollision) {
    void storage.set(
      `handle:${handleKey}`,
      { linkId: key, signer: incomingSigner },
      { nx: true, exSeconds: 86400 * 90 }
    );
  }

  if (!record.revoked) {
    registerVerifiedLinkPolicy({
      linkId: key,
      policy: params.payload.policy,
      vaultAddress: params.payload.vaultAddress,
      signer: params.payload.signer,
    });
    if (!handleCollision) {
      registerVerifiedLinkPolicy({
        linkId: params.payload.handle.trim(),
        policy: params.payload.policy,
        vaultAddress: params.payload.vaultAddress,
        signer: params.payload.signer,
      });
    }
  }

  return {
    record,
    handleCollision,
    handleOwner,
  };
}

export function getStoredLinkRecord(
  linkIdOrHandle: string | null | undefined
): StoredPaymentLinkRecord | null {
  if (!linkIdOrHandle) return null;
  const key = linkIdOrHandle.trim().toLowerCase();
  return linkRecordById.get(key) ?? linkRecordByHandle.get(key) ?? null;
}

export async function getStoredLinkRecordAsync(
  linkIdOrHandle: string | null | undefined
): Promise<StoredPaymentLinkRecord | null> {
  if (!linkIdOrHandle) return null;
  const key = linkIdOrHandle.trim().toLowerCase();
  const cached = linkRecordById.get(key) ?? linkRecordByHandle.get(key);
  if (cached) return cached;

  const storage = getStorage();
  const storedById = await storage.get<StoredPaymentLinkRecord>(`link:${key}`);
  if (storedById) {
    linkRecordById.set(storedById.linkId, storedById);
    return storedById;
  }

  const handleInfo = await storage.get<{ linkId: string; signer: string }>(
    `handle:${key}`
  );
  if (handleInfo?.linkId) {
    const storedByHandle = await storage.get<StoredPaymentLinkRecord>(
      `link:${handleInfo.linkId}`
    );
    if (storedByHandle) {
      linkRecordById.set(storedByHandle.linkId, storedByHandle);
      linkRecordByHandle.set(key, storedByHandle);
      return storedByHandle;
    }
  }

  return null;
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

  // Persist revocation durably to storage
  const storage = getStorage();
  void storage.set(
    `revoked:${key}`,
    { revokedAt: params.issuedAt, signer: params.signer.toLowerCase() },
    { exSeconds: 86400 * 365 }
  );
}

export function isLinkRevoked(linkId: string | null | undefined): boolean {
  if (!linkId) return false;
  const key = linkId.trim().toLowerCase();
  if (revokedLinkSet.has(key)) return true;
  const rec = getStoredLinkRecord(key);
  return Boolean(rec?.revoked);
}

export async function isLinkRevokedAsync(
  linkId: string | null | undefined
): Promise<boolean> {
  if (!linkId) return false;
  const key = linkId.trim().toLowerCase();
  if (revokedLinkSet.has(key)) return true;

  const storage = getStorage();
  const rev = await storage.get<{ revokedAt: string; signer: string }>(
    `revoked:${key}`
  );
  if (rev) {
    revokedLinkSet.set(key, rev);
    return true;
  }

  const rec = await getStoredLinkRecordAsync(key);
  return Boolean(rec?.revoked);
}

export function clearLinkStoreForTests(): void {
  linkRecordById.clear();
  linkRecordByHandle.clear();
  revokedLinkSet.clear();
}
