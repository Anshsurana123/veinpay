import type {
  ExecutionEngineSource,
  PaymentAssetSymbol,
  VerdictStatus,
} from '@/types/veilpay';

export type VeilPayEventStatus =
  | 'BLOCKED'
  | 'ALLOWED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'AWAITING_PAYMENT'
  | 'CLAIMED_UNVERIFIED';

export type VeilPayEventType =
  | 'SCAN_RESULT'
  | 'SETTLEMENT_ATTEMPT'
  | 'SETTLEMENT_CONFIRMED';

export interface VeilPayEvent {
  id: string;
  linkId: string;
  timestamp: string; // ISO-8601
  eventType: VeilPayEventType;
  status: VeilPayEventStatus;
  simulated: boolean;
  payerAddress: string;
  payerLabel?: string;
  receiverVault: string;
  amount: string;
  asset: PaymentAssetSymbol;
  sourceChainId: number;
  sourceChainName: string;
  destinationChainId?: number;
  verdict?: VerdictStatus;
  hopDistance?: number | null;
  latencyMs?: number;
  executionSource?: ExecutionEngineSource;
  txHash?: string;
  bridgeUsed?: string;
  sha256Hash?: string;
  errorMessage?: string;
}

export interface ThreatMetricsSummary {
  totalThreatsIntercepted: number;
  totalSettledVolumeUsd: number;
  liveEventsCount: number;
  isPersistent: boolean;
}
