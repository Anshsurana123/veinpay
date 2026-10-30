import { CctpRoute, CctpTransferRecord, CctpTransferStatus } from '@/types/veinpay';

export const ALLOWED_CCTP_TRANSITIONS: Record<CctpTransferStatus, CctpTransferStatus[]> = {
  QUOTED: ['APPROVING', 'BURN_PENDING', 'FAILED'],
  APPROVING: ['BURN_PENDING', 'FAILED'],
  BURN_PENDING: ['BURN_CONFIRMED', 'FAILED'],
  BURN_CONFIRMED: ['ATTESTATION_PENDING', 'ATTESTED', 'FAILED'],
  ATTESTATION_PENDING: ['ATTESTED', 'FAILED'],
  ATTESTED: ['MINT_PENDING', 'MINTED', 'FAILED'],
  MINT_PENDING: ['MINTED', 'FAILED'],
  MINTED: [],
  FAILED: ['APPROVING', 'BURN_PENDING', 'ATTESTATION_PENDING', 'MINT_PENDING'],
};

export function canTransitionCctpStatus(
  from: CctpTransferStatus,
  to: CctpTransferStatus
): boolean {
  if (from === to) return true;
  return ALLOWED_CCTP_TRANSITIONS[from]?.includes(to) ?? false;
}

export function createCctpTransferRecord(params: {
  id?: string;
  linkId: string;
  payerAddress: string;
  receiverVaultAddress: `0x${string}`;
  route: CctpRoute;
  burnTxHash?: `0x${string}`;
  nowMs?: number;
}): CctpTransferRecord {
  const now = new Date(params.nowMs ?? Date.now()).toISOString();
  const { route } = params;
  return {
    id: params.id ?? `cctp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    linkId: params.linkId,
    route,
    burnTxHash:
      params.burnTxHash ??
      ('0x0000000000000000000000000000000000000000000000000000000000000000' as const),
    status: 'QUOTED',
    payerAddress: params.payerAddress,
    receiverVaultAddress: params.receiverVaultAddress,
    sourceChainId: route.sourceChainId,
    destinationChainId: route.destinationChainId,
    sourceDomain: route.sourceDomain,
    destinationDomain: route.destinationDomain,
    amountInAtomic: route.amountInAtomic,
    totalFeeAtomic: route.totalFeeAtomic,
    netAmountOutAtomic: route.netAmountOutAtomic,
    finalityMode: route.finalityMode,
    minFinalityThreshold: route.minFinalityThreshold,
    useForwardingService: route.useForwardingService,
    createdAt: now,
    updatedAt: now,
    history: [{ status: 'QUOTED', timestamp: now }],
  };
}

export function transitionCctpTransfer(
  record: CctpTransferRecord,
  nextStatus: CctpTransferStatus,
  patch?: Partial<
    Pick<
      CctpTransferRecord,
      | 'approvalTxHash'
      | 'burnTxHash'
      | 'mintTxHash'
      | 'messageBytes'
      | 'attestationHex'
      | 'cctpNonce'
      | 'failureReason'
    >
  >,
  nowMs?: number
): CctpTransferRecord {
  if (!canTransitionCctpStatus(record.status, nextStatus)) {
    throw new Error(
      `Invalid CCTP state transition from ${record.status} to ${nextStatus}`
    );
  }

  if (nextStatus === 'FAILED' && !patch?.failureReason && !record.failureReason) {
    throw new Error('CCTP transition to FAILED requires a failureReason');
  }

  const updatedAt = new Date(nowMs ?? Date.now()).toISOString();
  return {
    ...record,
    ...patch,
    status: nextStatus,
    updatedAt,
    history: [
      ...record.history,
      {
        status: nextStatus,
        timestamp: updatedAt,
        detail: patch?.failureReason ?? undefined,
      },
    ],
  };
}

const STORAGE_KEY = 'veinpay_cctp_transfers_v2';
const ZERO_TX_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000';
const memoryByBurnHash = new Map<string, CctpTransferRecord>();
const memoryById = new Map<string, CctpTransferRecord>();

export type CctpTransitionListener = (record: CctpTransferRecord) => void | Promise<void>;
const listeners = new Set<CctpTransitionListener>();

export function onCctpTransferTransition(listener: CctpTransitionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readBrowserStorage(): Record<string, CctpTransferRecord> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CctpTransferRecord>;
  } catch {
    return {};
  }
}

function writeBrowserStorage(records: Record<string, CctpTransferRecord>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
}

export function saveCctpTransferRecord(record: CctpTransferRecord): CctpTransferRecord {
  memoryById.set(record.id, record);
  const hasRealBurnHash =
    record.burnTxHash && record.burnTxHash.toLowerCase() !== ZERO_TX_HASH;
  if (hasRealBurnHash) {
    memoryByBurnHash.set(record.burnTxHash.toLowerCase(), record);
  }

  if (typeof window !== 'undefined') {
    const existing = readBrowserStorage();
    const key = hasRealBurnHash ? record.burnTxHash.toLowerCase() : record.id;
    existing[key] = record;
    writeBrowserStorage(existing);
  }

  for (const listener of listeners) {
    try {
      void listener(record);
    } catch {
      // Listener errors should not break state persistence
    }
  }

  return record;
}

export function getCctpTransferByBurnTxHash(burnTxHash: string): CctpTransferRecord | null {
  const key = burnTxHash.toLowerCase();
  const inMem = memoryByBurnHash.get(key);
  if (inMem) return inMem;

  if (typeof window !== 'undefined') {
    const stored = readBrowserStorage();
    if (stored[key]) {
      memoryByBurnHash.set(key, stored[key]);
      memoryById.set(stored[key].id, stored[key]);
      return stored[key];
    }
    for (const rec of Object.values(stored)) {
      if (rec.burnTxHash?.toLowerCase() === key) {
        memoryByBurnHash.set(key, rec);
        memoryById.set(rec.id, rec);
        return rec;
      }
    }
  }

  return null;
}

export function listCctpTransferRecords(linkId?: string): CctpTransferRecord[] {
  const merged = new Map<string, CctpTransferRecord>();
  for (const rec of memoryById.values()) {
    const hasRealBurnHash =
      rec.burnTxHash && rec.burnTxHash.toLowerCase() !== ZERO_TX_HASH;
    merged.set(hasRealBurnHash ? rec.burnTxHash.toLowerCase() : rec.id, rec);
  }
  if (typeof window !== 'undefined') {
    const stored = readBrowserStorage();
    for (const [k, rec] of Object.entries(stored)) {
      if (!merged.has(k)) {
        merged.set(k, rec);
      }
    }
  }
  const list = Array.from(merged.values());
  const filtered = linkId ? list.filter((r) => r.linkId === linkId) : list;
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function clearCctpTransferStoreForTests(): void {
  memoryByBurnHash.clear();
  memoryById.clear();
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
