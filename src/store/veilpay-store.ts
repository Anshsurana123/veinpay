'use client';

import { create } from 'zustand';
import type {
  AigiForensicReceipt,
  CrawlSafetySettings,
  FirewallPolicyConfig,
  FirewallScanResult,
  HopDepth,
  OutboundPoisonScanResult,
  PaymentFeedItem,
  PersonaType,
  SettlementAssetSymbol,
  VaultSettlementMode,
  VeilPayLinkConfig,
  VeilPayQuoteResult,
} from '@/types/veilpay';
import {
  CANONICAL_PERSONAS,
  MERCHANT_EVM_VAULT,
} from '@/lib/graph/seed-topologies';
import {
  MERCHANT_BTC_SILENT_ADDRESS,
  MERCHANT_XMR_SUBADDRESS,
} from '@/lib/validators/address';
import {
  EVM_CHAIN_TOKENS,
  SUPPORTED_EVM_CHAINS,
  usdToTokenRawUnits,
} from '@/lib/socket/tokens';

export interface VeilPayStoreState {
  // UI Navigation
  activeLeftTab: 'LINK_BUILDER' | 'SAFE_SEND' | 'INCOMING_FEED';
  viewLayout: 'SPLIT' | 'RECEIVER_ONLY' | 'PAYER_ONLY';
  settingsDrawerOpen: boolean;
  settlementModalOpen: boolean;
  showRawGsqlInspector: boolean;

  // Receiver Payment Link Configuration
  linkConfig: VeilPayLinkConfig;

  // Payer Checkout Simulator State
  activePersonaId: PersonaType;
  activePayerAddress: string;
  customAddressInput: string;
  payerChainId: number;
  payerTokenSymbol: 'USDC' | 'USDT' | 'ETH';

  // Firewall Scan, AIGI Receipt & SOCKET Quote
  activeScan: FirewallScanResult | null;
  activeReceipt: AigiForensicReceipt | null;
  activeQuote: VeilPayQuoteResult | null;
  isScanning: boolean;
  isLoadingQuote: boolean;
  isGeneratingAiNarrative: boolean;
  scannerStep: 0 | 1 | 2 | 3;
  scanError: string | null;

  // Graph Canvas Interactive State
  selectedGraphNodeId: string | null;
  selectedGraphEdgeId: string | null;
  sybilClusterExpanded: boolean;

  // Module E: Safe Send Outbound Guard
  outboundCandidateInput: string;
  outboundExpectedMode: VaultSettlementMode;
  outboundScanResult: OutboundPoisonScanResult | null;
  isScanningOutbound: boolean;

  // Telemetry & Payment Feed
  paymentFeed: PaymentFeedItem[];
  totalThreatsIntercepted: number;
  lastMeasuredLatencyMs: number;
  crawlSettings: CrawlSafetySettings;

  // Actions
  setActiveLeftTab: (tab: 'LINK_BUILDER' | 'SAFE_SEND' | 'INCOMING_FEED') => void;
  setViewLayout: (layout: 'SPLIT' | 'RECEIVER_ONLY' | 'PAYER_ONLY') => void;
  setSettingsDrawerOpen: (open: boolean) => void;
  setSettlementModalOpen: (open: boolean) => void;
  setShowRawGsqlInspector: (show: boolean) => void;
  setSelectedGraphNodeId: (id: string | null) => void;
  setSelectedGraphEdgeId: (id: string | null) => void;
  setSybilClusterExpanded: (expanded: boolean) => void;

  // Link Config Updaters
  updateLinkConfig: (partial: Partial<VeilPayLinkConfig>) => void;
  setVaultMode: (mode: VaultSettlementMode) => void;
  setDestinationChainAndAsset: (
    chainId: number,
    asset: SettlementAssetSymbol
  ) => void;
  updateFirewallPolicy: (partial: Partial<FirewallPolicyConfig>) => void;
  hydrateFromDecodedLink: (decoded: VeilPayLinkConfig) => void;

  // Payer Actions
  selectPersona: (personaId: PersonaType, customAddress?: string) => void;
  setCustomAddressInput: (input: string) => void;
  setPayerChainAndToken: (
    chainId: number,
    tokenSymbol: 'USDC' | 'USDT' | 'ETH'
  ) => void;
  runFirewallAndQuotePipeline: () => Promise<void>;
  requestGeminiExecutiveSummary: () => Promise<void>;
  recordSimulatedSettlement: (txHash?: string) => void;

  // Module E Outbound Guard Actions
  setOutboundCandidateInput: (input: string) => void;
  setOutboundExpectedMode: (mode: VaultSettlementMode) => void;
  runOutboundPoisonScan: (overrideCandidate?: string, overrideMode?: VaultSettlementMode) => Promise<void>;
  swapToVerifiedContactAddress: () => Promise<void>;

  // Crawl & Safety Settings
  updateCrawlSettings: (partial: Partial<CrawlSafetySettings>) => void;
}

const INITIAL_PAYMENT_FEED: PaymentFeedItem[] = [
  {
    id: 'feed-01',
    timestamp: '2026-10-28T13:02:14.000Z',
    payerAddress: '0x99B1D84E7c5A2310f8629aBCdEf0123456789FC2',
    amountUsd: '250.00',
    sourceChainName: 'Arbitrum',
    status: 'INTERCEPTED',
    verdict: 'INTERCEPTED_TAINT',
    hopDistance: 2,
    latencyMs: 3.42,
    sha256Hash:
      '9f4a8d2c7e1b60395f82c1d4a70e3b98126c5d4f8a90b1e23c4d5f6a7b8c9d0e',
  },
  {
    id: 'feed-02',
    timestamp: '2026-10-28T12:58:40.000Z',
    payerAddress: '0x88F01b2C3D4e5F6a7B8c9d0E1f2A3B4C5D6e7441',
    amountUsd: '250.00',
    sourceChainName: 'Optimism',
    status: 'INTERCEPTED',
    verdict: 'INTERCEPTED_SYBIL',
    hopDistance: 2,
    latencyMs: 4.18,
    sha256Hash:
      '3c1e7b9a4d20f8561e3c9b7a4d2f80156e3c9b7a4d20f8561e3c9b7a4d2f8015',
  },
  {
    id: 'feed-03',
    timestamp: '2026-10-28T12:49:11.000Z',
    payerAddress: '0x4F92a81d6002E93b1a74C88912E3B4f01928374A',
    amountUsd: '250.00',
    sourceChainName: 'Arbitrum',
    status: 'SETTLED',
    verdict: 'VERIFIED_CLEAN',
    hopDistance: null,
    bridgeUsed: 'Across Protocol (SOCKET V3)',
    latencyMs: 2.15,
    sha256Hash:
      '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
  },
];

export const useVeilPayStore = create<VeilPayStoreState>((set, get) => ({
  activeLeftTab: 'LINK_BUILDER',
  viewLayout: 'SPLIT',
  settingsDrawerOpen: false,
  settlementModalOpen: false,
  showRawGsqlInspector: false,

  linkConfig: {
    handle: 'goa.eth',
    amountUsd: '250.00',
    settlementAsset: 'USDC',
    destinationChainId: 8453,
    destinationChainName: 'Base',
    destinationTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    vaultMode: 'EVM_SOCKET',
    receiverVaultAddress: MERCHANT_EVM_VAULT,
    firewallPolicy: {
      masterEnabled: true,
      maxHops: 3,
      cleanLinkEnabled: true,
      unbundleEnabled: true,
      poisonGraphEnabled: true,
      sybilBlockThreshold: 10,
      socketAutoBridgeEnabled: true,
    },
    createdAt: 1730120000000,
  },

  activePersonaId: 'CLEAN_PAYER',
  activePayerAddress: CANONICAL_PERSONAS[0].address,
  customAddressInput: '',
  payerChainId: 42161,
  payerTokenSymbol: 'USDC',

  activeScan: null,
  activeReceipt: null,
  activeQuote: null,
  isScanning: false,
  isLoadingQuote: false,
  isGeneratingAiNarrative: false,
  scannerStep: 0,
  scanError: null,

  selectedGraphNodeId: null,
  selectedGraphEdgeId: null,
  sybilClusterExpanded: false,

  outboundCandidateInput: '0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B',
  outboundExpectedMode: 'EVM_SOCKET',
  outboundScanResult: null,
  isScanningOutbound: false,

  paymentFeed: INITIAL_PAYMENT_FEED,
  totalThreatsIntercepted: 14,
  lastMeasuredLatencyMs: 2.84,
  crawlSettings: {
    liveEtherscanCrawlEnabled: true,
    topFundersPerVertex: 5,
    maxApiCallsPerScan: 40,
    mainnetSafetyCapUsd: Number(process.env.NEXT_PUBLIC_MAX_MAINNET_USD ?? 5),
    preferLiveTigerGraphRestpp: true,
  },

  setActiveLeftTab: (tab) => set({ activeLeftTab: tab }),
  setViewLayout: (layout) => set({ viewLayout: layout }),
  setSettingsDrawerOpen: (open) => set({ settingsDrawerOpen: open }),
  setSettlementModalOpen: (open) => set({ settlementModalOpen: open }),
  setShowRawGsqlInspector: (show) => set({ showRawGsqlInspector: show }),
  setSelectedGraphNodeId: (id) => set({ selectedGraphNodeId: id }),
  setSelectedGraphEdgeId: (id) => set({ selectedGraphEdgeId: id }),
  setSybilClusterExpanded: (expanded) => set({ sybilClusterExpanded: expanded }),

  updateLinkConfig: (partial) => {
    set((state) => ({
      linkConfig: {
        ...state.linkConfig,
        ...partial,
      },
    }));
  },

  setVaultMode: (mode) => {
    set((state) => {
      let receiverVaultAddress = MERCHANT_EVM_VAULT;
      let settlementAsset: SettlementAssetSymbol = state.linkConfig.settlementAsset;
      if (mode === 'BTC_SILENT_PAYMENT') {
        receiverVaultAddress = MERCHANT_BTC_SILENT_ADDRESS;
        settlementAsset = 'BTC';
      } else if (mode === 'XMR_SUBADDRESS') {
        receiverVaultAddress = MERCHANT_XMR_SUBADDRESS;
        settlementAsset = 'XMR';
      } else if (settlementAsset === 'BTC' || settlementAsset === 'XMR') {
        settlementAsset = 'USDC';
      }

      return {
        linkConfig: {
          ...state.linkConfig,
          vaultMode: mode,
          receiverVaultAddress,
          settlementAsset,
        },
      };
    });
  },

  setDestinationChainAndAsset: (chainId, asset) => {
    const chainObj =
      SUPPORTED_EVM_CHAINS.find((c) => c.chainId === chainId) ??
      SUPPORTED_EVM_CHAINS[0];
    const tokenKey = asset === 'ETH' || asset === 'USDT' ? asset : 'USDC';
    const tokenMeta =
      EVM_CHAIN_TOKENS[chainObj.chainId]?.[tokenKey] ??
      EVM_CHAIN_TOKENS[8453].USDC;

    set((state) => ({
      linkConfig: {
        ...state.linkConfig,
        destinationChainId: chainObj.chainId,
        destinationChainName: chainObj.name,
        settlementAsset: asset,
        destinationTokenAddress: tokenMeta.address,
      },
    }));
    void get().runFirewallAndQuotePipeline();
  },

  updateFirewallPolicy: (partial) => {
    set((state) => ({
      linkConfig: {
        ...state.linkConfig,
        firewallPolicy: {
          ...state.linkConfig.firewallPolicy,
          ...partial,
        },
      },
    }));
    void get().runFirewallAndQuotePipeline();
  },

  hydrateFromDecodedLink: (decoded) => {
    set({ linkConfig: decoded });
    void get().runFirewallAndQuotePipeline();
  },

  selectPersona: (personaId, customAddress) => {
    if (personaId === 'CUSTOM' && customAddress) {
      set({
        activePersonaId: 'CUSTOM',
        activePayerAddress: customAddress.trim(),
        selectedGraphNodeId: null,
        selectedGraphEdgeId: null,
      });
    } else {
      const found =
        CANONICAL_PERSONAS.find((p) => p.id === personaId) ??
        CANONICAL_PERSONAS[0];
      set({
        activePersonaId: found.id,
        activePayerAddress: found.address,
        selectedGraphNodeId: null,
        selectedGraphEdgeId: null,
      });
    }
    void get().runFirewallAndQuotePipeline();
  },

  setCustomAddressInput: (input) => set({ customAddressInput: input }),

  setPayerChainAndToken: (chainId, tokenSymbol) => {
    set({ payerChainId: chainId, payerTokenSymbol: tokenSymbol });
    void get().runFirewallAndQuotePipeline();
  },

  runFirewallAndQuotePipeline: async () => {
    const state = get();
    const payerAddress = state.activePayerAddress;
    const { linkConfig, payerChainId, payerTokenSymbol, crawlSettings } = state;

    set({
      isScanning: true,
      scannerStep: 1,
      scanError: null,
      activeQuote: null,
    });

    try {
      // Step 2: Execute TigerGraph 3-in-1 Pre-Flight Firewall Scan + AIGI Receipt
      set({ scannerStep: 2 });
      const scanRes = await fetch('/api/firewall/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerAddress,
          receiverAddress: linkConfig.receiverVaultAddress,
          chainId: payerChainId,
          policy: linkConfig.firewallPolicy,
          crawlSettings,
          includeGeminiNarrative: false,
        }),
      });

      const scanJson = await scanRes.json();
      if (!scanRes.ok) {
        throw new Error(scanJson.error || 'Firewall scan failed');
      }

      const scan: FirewallScanResult = scanJson.scan;
      const receipt: AigiForensicReceipt = scanJson.receipt;

      set((prev) => ({
        activeScan: scan,
        activeReceipt: receipt,
        isScanning: false,
        scannerStep: 3,
        lastMeasuredLatencyMs: scan.executionTimeMs,
        totalThreatsIntercepted: scan.blocked
          ? prev.totalThreatsIntercepted + 1
          : prev.totalThreatsIntercepted,
      }));

      // Step 3: ONLY IF firewall did NOT block AND socketAutoBridgeEnabled is true, fetch SOCKET V3 Quote
      if (!scan.blocked && linkConfig.firewallPolicy.socketAutoBridgeEnabled) {
        set({ isLoadingQuote: true });

        const fromTokenMeta =
          EVM_CHAIN_TOKENS[payerChainId]?.[payerTokenSymbol] ??
          EVM_CHAIN_TOKENS[42161].USDC;
        const destAssetKey =
          linkConfig.settlementAsset === 'ETH' ||
          linkConfig.settlementAsset === 'USDT'
            ? linkConfig.settlementAsset
            : 'USDC';
        const toTokenMeta =
          EVM_CHAIN_TOKENS[linkConfig.destinationChainId]?.[destAssetKey] ??
          EVM_CHAIN_TOKENS[8453].USDC;

        const fromAmountRaw = usdToTokenRawUnits(
          linkConfig.amountUsd,
          fromTokenMeta
        );

        const qs = new URLSearchParams({
          fromChainId: String(payerChainId),
          fromTokenAddress: fromTokenMeta.address,
          toChainId: String(linkConfig.destinationChainId),
          toTokenAddress: toTokenMeta.address,
          fromAmount: fromAmountRaw,
          userAddress: payerAddress,
          recipient:
            linkConfig.vaultMode === 'EVM_SOCKET'
              ? linkConfig.receiverVaultAddress
              : MERCHANT_EVM_VAULT,
          maxHops: String(linkConfig.firewallPolicy.maxHops),
          masterEnabled: String(linkConfig.firewallPolicy.masterEnabled),
          cleanLinkEnabled: String(linkConfig.firewallPolicy.cleanLinkEnabled),
          unbundleEnabled: String(linkConfig.firewallPolicy.unbundleEnabled),
          poisonGraphEnabled: String(
            linkConfig.firewallPolicy.poisonGraphEnabled
          ),
          sybilBlockThreshold: String(
            linkConfig.firewallPolicy.sybilBlockThreshold
          ),
        });

        const quoteRes = await fetch(`/api/socket/quote?${qs.toString()}`);
        if (quoteRes.ok) {
          const quoteData: VeilPayQuoteResult = await quoteRes.json();
          set({ activeQuote: quoteData, isLoadingQuote: false });
        } else {
          set({ isLoadingQuote: false });
        }
      }
    } catch (err) {
      set({
        isScanning: false,
        isLoadingQuote: false,
        scannerStep: 0,
        scanError:
          err instanceof Error ? err.message : 'Unexpected firewall error',
      });
    }
  },

  requestGeminiExecutiveSummary: async () => {
    const { activeScan } = get();
    if (!activeScan) return;

    set({ isGeneratingAiNarrative: true });
    try {
      const res = await fetch('/api/aigi/verdict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanResult: activeScan,
          includeGeminiNarrative: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        set({
          activeReceipt: data.receipt,
          isGeneratingAiNarrative: false,
        });
      } else {
        set({ isGeneratingAiNarrative: false });
      }
    } catch {
      set({ isGeneratingAiNarrative: false });
    }
  },

  recordSimulatedSettlement: (txHash) => {
    const state = get();
    if (!state.activeScan || !state.activeReceipt) return;
    const sourceChain =
      SUPPORTED_EVM_CHAINS.find((c) => c.chainId === state.payerChainId)
        ?.name ?? 'Arbitrum';
    const bridgeName =
      state.activeQuote?.routes[0]?.usedBridgeNames[0] ?? 'Cake Wallet Vault';

    const newItem: PaymentFeedItem = {
      id: `feed-${Date.now()}`,
      timestamp: new Date().toISOString(),
      payerAddress: state.activePayerAddress,
      amountUsd: state.linkConfig.amountUsd,
      sourceChainName: sourceChain,
      status: state.activeScan.blocked ? 'INTERCEPTED' : 'SETTLED',
      verdict: state.activeScan.verdict,
      hopDistance: state.activeScan.hopDistance,
      bridgeUsed: txHash ? `${bridgeName} (${txHash.slice(0, 10)}...)` : bridgeName,
      latencyMs: state.activeScan.executionTimeMs,
      sha256Hash: state.activeReceipt.sha256CommitmentHash,
    };

    set((prev) => ({
      paymentFeed: [newItem, ...prev.paymentFeed],
    }));
  },

  setOutboundCandidateInput: (input) => set({ outboundCandidateInput: input }),

  setOutboundExpectedMode: (mode) => {
    set({ outboundExpectedMode: mode });
    void get().runOutboundPoisonScan(undefined, mode);
  },

  runOutboundPoisonScan: async (overrideCandidate, overrideMode) => {
    const state = get();
    const candidateInput =
      overrideCandidate !== undefined
        ? overrideCandidate
        : state.outboundCandidateInput;
    const expectedMode =
      overrideMode !== undefined ? overrideMode : state.outboundExpectedMode;

    if (overrideCandidate !== undefined) {
      set({ outboundCandidateInput: overrideCandidate });
    }

    set({ isScanningOutbound: true });
    try {
      const res = await fetch('/api/firewall/poison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateInput,
          expectedMode,
        }),
      });
      const data: OutboundPoisonScanResult = await res.json();
      set({ outboundScanResult: data, isScanningOutbound: false });
    } catch {
      set({ isScanningOutbound: false });
    }
  },

  swapToVerifiedContactAddress: async () => {
    const { outboundScanResult } = get();
    if (!outboundScanResult?.matchedTrustedContact) return;
    const verifiedAddr = outboundScanResult.matchedTrustedContact.address;
    await get().runOutboundPoisonScan(verifiedAddr);
  },

  updateCrawlSettings: (partial) =>
    set((state) => ({
      crawlSettings: {
        ...state.crawlSettings,
        ...partial,
      },
    })),
}));
