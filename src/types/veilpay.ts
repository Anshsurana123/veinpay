export type PaymentAssetSymbol = 'USDC' | 'ETH' | 'USDT' | 'BTC' | 'XMR';

export type VaultSettlementMode = 'EVM_SOCKET' | 'BTC_SILENT_PAYMENT' | 'XMR_SUBADDRESS';

export type HopDepth = 1 | 2 | 3 | 4 | 5;

export type SupportedEvmChainId =
  | 1
  | 42161
  | 8453
  | 10
  | 137
  | 11155111
  | 84532
  | 421614
  | 11155420
  | 80002;

export type VerdictStatus =
  | 'VERIFIED_CLEAN'
  | 'INTERCEPTED_TAINT'
  | 'INTERCEPTED_SYBIL'
  | 'WARNING_SYBIL'
  | 'INTERCEPTED_POISONING'
  | 'ADVISORY_BYPASSED';

export type ExecutionEngineSource =
  | 'IN_MEMORY_GSQL_ENGINE'
  | 'TIGERGRAPH_RESTPP_LIVE'
  | 'ETHERSCAN_V2_LIVE_CRAWL';

export type VertexType = 'Wallet' | 'Merchant' | 'ThreatEntity';

export type RiskCategory =
  | 'CLEAN'
  | 'PAYER_TARGET'
  | 'MERCHANT_VAULT'
  | 'APPROVAL_DRAINER'
  | 'SANCTIONED_MIXER'
  | 'EXPLOIT_CONTRACT'
  | 'SYBIL_ROOT_FUNDER'
  | 'SYBIL_SIBLING'
  | 'WASH_CYCLE_NODE'
  | 'POISON_DUST_FACTORY'
  | 'TRUSTED_CONTACT'
  | 'INTERMEDIATE_MULE';

export interface GraphVertex {
  id: string;
  v_type: VertexType;
  label: string;
  riskTag: RiskCategory;
  hopDistance: number;
  chainId?: number;
  isTainted: boolean;
  isSybilRoot?: boolean;
  isSybilSibling?: boolean;
  isCyclicMember?: boolean;
  dustOutDegree?: number;
  txCount?: number;
  firstSeen?: string;
  threatSource?: string;
}

export interface GraphEdgeAttributes {
  amount: number;
  amount_usd: number;
  token: string;
  tx_hash: string;
  block_number: number;
  timestamp: string;
  hop_distance: number;
  is_taint_path?: boolean;
  is_sybil_fanout?: boolean;
  is_cyclic_edge?: boolean;
  is_dust?: boolean;
}

export interface GraphEdge {
  id: string;
  e_type: 'TRANSFERRED_TO' | 'DUSTED';
  from_id: string;
  from_type: VertexType;
  to_id: string;
  to_type: VertexType;
  attributes: GraphEdgeAttributes;
}

export interface FirewallPolicyConfig {
  firewallEnabled: boolean;
  maxHops: HopDepth;
  cleanLinkEnabled: boolean;
  unbundleEnabled: boolean;
  socketAutoBridgeEnabled: boolean;
  sybilBlockThreshold: number;
}

export interface VeilPayLinkConfig {
  handle: string;
  amount: string;
  asset: PaymentAssetSymbol;
  destinationChainId: SupportedEvmChainId;
  settlementMode: VaultSettlementMode;
  vaultAddresses: {
    EVM_SOCKET: string;
    BTC_SILENT_PAYMENT: string;
    XMR_SUBADDRESS: string;
  };
  policy: FirewallPolicyConfig;
  createdAt: string;
}

export interface TigerGraphRestppEnvelope {
  version: {
    edition: string;
    api: string;
    schema: number;
  };
  error: boolean;
  message: string;
  results: Array<{
    verdict: VerdictStatus;
    target_wallet: string;
    merchant_wallet: string;
    max_hops_queried: number;
    min_taint_hop: number | null;
    taint_hits: number;
    sybil_cluster_size: number;
    sybil_root_funder: string;
    cyclic_loop_detected: boolean;
    self_transfer_detected: boolean;
    dust_out_degree: number;
    nodes_scanned: number;
    edges_traversed: number;
    '@@evidence_edges': GraphEdge[];
  }>;
}

export interface FirewallScanResult {
  verdict: VerdictStatus;
  socketUnlocked: boolean;
  vaultUriUnlocked: boolean;
  targetWallet: string;
  merchantWallet: string;
  maxHopsQueried: HopDepth;
  policyApplied: FirewallPolicyConfig;
  executionTimeMs: number;
  executionSource: ExecutionEngineSource;
  minTaintHop: number | null;
  taintHits: number;
  taintedRootEntities: GraphVertex[];
  sybilClusterSize: number;
  sybilRootFunder: string | null;
  sybilSiblingWallets: string[];
  cyclicLoopDetected: boolean;
  detectedCyclePaths: string[][];
  selfTransferDetected: boolean;
  dustOutDegree: number;
  nodesScanned: number;
  edgesTraversed: number;
  shallowScanAdvisory: string | null;
  liveCrawlNotes: string | null;
  crawlTruncated?: boolean;
  vertices: GraphVertex[];
  edges: GraphEdge[];
  evidenceEdges: GraphEdge[];
  restppEnvelope: TigerGraphRestppEnvelope;
  gsqlQuerySnippet: string;
  timestamp: string;
}

export interface HopEvidenceStep {
  hopNumber: number;
  fromAddress: string;
  fromLabel: string;
  fromRiskTag: RiskCategory;
  toAddress: string;
  toLabel: string;
  txHash: string;
  amount: number;
  amountUsd: number;
  token: string;
  blockNumber: number;
  timestamp: string;
  narrative: string;
}

export interface AigiForensicReceipt {
  receiptId: string;
  verdictStatus: VerdictStatus;
  badgeTitle: string;
  badgeSummary: string;
  targetWallet: string;
  merchantWallet: string;
  telemetry: {
    nodesScanned: number;
    edgesTraversed: number;
    maxHopDepth: number;
    executionTimeMs: number;
    executionSource: ExecutionEngineSource;
    taintHits: number;
    sybilClusterSize: number;
    dustOutDegree: number;
  };
  evidenceChain: HopEvidenceStep[];
  deterministicNarrative: string;
  geminiExecutiveSummary?: string | null;
  geminiModelUsed?: string | null;
  cryptographicAuditHash: string;
  canonicalPayloadJson: string;
  generatedAt: string;
}

export interface CharDiffSegment {
  index: number;
  candidateChar: string;
  trustedChar: string;
  zone: 'PREFIX' | 'MIDDLE' | 'SUFFIX';
  matches: boolean;
  status: 'MATCH_PREFIX_SUFFIX' | 'FORGED_MIDDLE' | 'NEUTRAL';
}

export interface OutboundPoisonScanResult {
  verdict:
    | 'INTERCEPTED_POISONING'
    | 'VERIFIED_TRUSTED_CONTACT'
    | 'VERIFIED_FIRST_TIME_RECIPIENT'
    | 'INVALID_ADDRESS_OR_NETWORK_MISMATCH';
  candidateAddress: string;
  normalizedCandidateAddress: string | null;
  validationError?: string;
  detectedProtocol?: 'EVM' | 'BTC_SILENT_PAYMENT' | 'XMR_SUBADDRESS' | 'INVALID';
  checksumFixSuggestion?: string;
  matchedTrustedContact: {
    address: string;
    label: string;
    priorOutboundCount: number;
    lastPaidTimestamp: string;
    totalVolumeUsd: number;
  } | null;
  matchingPrefixChars: number;
  matchingSuffixChars: number;
  forgedMiddleChars: number;
  similarityScore: number;
  priorLegitimateInteractions: number;
  dustOutDegree: number;
  dustSampleTransfers: Array<{
    toAddress: string;
    amountUsd: number;
    token: string;
    txHash: string;
    timestamp: string;
  }>;
  charDiffGrid: CharDiffSegment[];
  executionTimeMs: number;
  summaryNarrative: string;
}

export interface NormalizedSocketRoute {
  quoteId: string;
  userOp: string;
  originChainId: number;
  destinationChainId: number;
  isSameChainDirect: boolean;
  // Brief V2 compatibility fields:
  toAmount: string;
  usedBridgeNames: string[];
  serviceTime: number;
  totalGasFeesInUsd: number;
  // Native V3 fields:
  outputAmountFormatted: string;
  minAmountOutFormatted: string;
  outputValueInUsd: number;
  inputAmountFormatted: string;
  inputValueInUsd: number;
  estimatedTime: number;
  slippage: number;
  routeTags: string[];
  bridgeProtocolName: string;
  bridgeDisplayName: string;
  bridgeIcon?: string;
  approval: {
    spenderAddress: string;
    amount: string;
    tokenAddress: string;
    userAddress: string;
  } | null;
  txData: {
    kind: string;
    object: {
      chainId: number;
      to: string;
      data: string;
      value: string;
    };
  };
  gasFee: {
    estimatedFee: string;
    feeInUsd: number;
  };
  statusCheckUrl: string;
}

export interface VeilPayQuoteResponse {
  success: boolean;
  statusCode: number;
  source:
    | 'SOCKET_V3_LIVE'
    | 'SAME_CHAIN_DIRECT'
    | 'TESTNET_BRIDGE_ROUTE'
    | 'FALLBACK_DETERMINISTIC';
  fallbackReason?: string;
  executionTimeMs: number;
  result: {
    originChainId: number;
    destinationChainId: number;
    userAddress: string;
    receiverAddress: string;
    routes: NormalizedSocketRoute[];
  };
}

export interface PaymentFeedItem {
  id: string;
  timestamp: string;
  payerAddress: string;
  payerLabel: string;
  amount: string;
  asset: PaymentAssetSymbol;
  originChainId: number;
  destinationChainId: number;
  maxHops: HopDepth;
  verdict: VerdictStatus;
  executionTimeMs: number;
  executionSource: ExecutionEngineSource;
  scanResult: FirewallScanResult;
  receipt: AigiForensicReceipt;
}

export interface LiveCrawlSettings {
  topFundersPerVertex: number;
  maxApiCallsPerScan: number;
  rateLimitRps: number;
  crawlTimeoutMs: number;
  maxMainnetUsdCap: number;
}
