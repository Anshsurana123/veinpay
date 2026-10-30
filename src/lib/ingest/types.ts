export type TokenKind = 'native' | 'erc20' | 'internal';

export interface NormalizedTransfer {
  chainId: number;
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  tokenKind: TokenKind;
  tokenAddress?: string;
  symbol: string;
  decimals: number;
  rawValue: bigint;
  amount: number;
  amountUsd: number | null;
  usdKnown: boolean;
  blockNumber: number;
  timestamp: string;
  isError: boolean;
  isSpam?: boolean;
}

export interface IngestCoverage {
  firstFunderQueried: boolean;
  recentWindowQueried: boolean;
  internalTxQueried: boolean;
  tokenTxQueried: boolean;
  inboundComplete: boolean;
  truncated: boolean;
  truncatedReason?: string;
  totalApiCalls: number;
  usedChainId: number;
  tierFallbackNote: string | null;
}

export interface FetchTransfersOptions {
  address: string;
  chainId: number;
  apiKey: string;
  maxApiCalls?: number;
  timeoutMs?: number;
  includeFirstFunder?: boolean;
  includeRecentWindow?: boolean;
  includeInternalTxs?: boolean;
  includeTokenTxs?: boolean;
}
