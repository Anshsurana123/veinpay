'use client';

import { create } from 'zustand';
import type {
  AigiForensicReceipt,
  ExecutionEngineSource,
  FirewallPolicyConfig,
  FirewallScanResult,
  HopDepth,
  LiveCrawlSettings,
  OutboundPoisonScanResult,
  PaymentAssetSymbol,
  SupportedEvmChainId,
  VaultSettlementMode,
  VeilPayLinkConfig,
  VeilPayQuoteResponse,
  VerdictStatus,
} from '@/types/veilpay';
import {
  OUTBOUND_POISON_TEST_PRESETS,
  WALLET_PERSONAS,
} from '@/lib/graph/seed-topologies';
import { DEFAULT_CAKE_VAULT_ADDRESSES } from '@/lib/validators/address';
import { DEFAULT_LINK_CONFIG } from '@/lib/utils/link-codec';
import {
  EVM_TOKEN_REGISTRY,
  SUPPORTED_EVM_CHAINS,
  toAtomicUnits,
} from '@/lib/socket/tokens';

export type ActivePersonaId =
  | 'persona-1'
  | 'persona-2'
  | 'persona-3'
  | 'persona-4'
  | 'custom';

export interface FeedLogEntry {
  id: string;
  timestamp: string;
  payerAddress: string;
  payerLabel: string;
  amount: string;
  asset: PaymentAssetSymbol;
  sourceChainName: string;
  status: 'INTERCEPTED' | 'SETTLED';
  verdict: VerdictStatus;
  hopDistance: number | null;
  bridgeUsed?: string;
  latencyMs: number;
  executionSource: ExecutionEngineSource;
  sha256Hash: string;
}

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
  activePersonaId: ActivePersonaId;
  activePayerAddress: string;
  customAddressInput: string;
  payerChainId: SupportedEvmChainId;
  payerTokenSymbol: 'USDC' | 'USDT' | 'ETH';

  // Firewall Scan, AIGI Receipt & SOCKET Quote
  activeScan: FirewallScanResult | null;
  activeReceipt: AigiForensicReceipt | null;
  activeQuote: VeilPayQuoteResponse | null;
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
  paymentFeed: FeedLogEntry[];
  totalThreatsIntercepted: number;
  lastMeasuredLatencyMs: number;
  crawlSettings: LiveCrawlSettings & {
    liveEtherscanCrawlEnabled: boolean;
    preferLiveTigerGraphRestpp: boolean;
  };

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
  setVaultAddress: (mode: VaultSettlementMode, address: string) => void;
  setDestinationChainAndAsset: (
    chainId: SupportedEvmChainId,
    asset: PaymentAssetSymbol
  ) => void;
  updateFirewallPolicy: (partial: Partial<FirewallPolicyConfig>) => void;
  hydrateFromDecodedLink: (decoded: VeilPayLinkConfig) => void;

  // Payer Actions
  selectPersona: (personaId: ActivePersonaId, customAddress?: string) => void;
  setCustomAddressInput: (input: string) => void;
  setPayerChainAndToken: (
    chainId: SupportedEvmChainId,
    tokenSymbol: 'USDC' | 'USDT' | 'ETH'
  ) => void;
  runFirewallAndQuotePipeline: () => Promise<void>;
  requestGeminiExecutiveSummary: () => Promise<void>;
  recordSimulatedSettlement: (txHash?: string) => void;

  // Module E Outbound Guard Actions
  setOutboundCandidateInput: (input: string) => void;
  setOutboundExpectedMode: (mode: VaultSettlementMode) => void;
  runOutboundPoisonScan: (
    overrideCandidate?: string,
    overrideMode?: VaultSettlementMode
  ) => Promise<void>;
  swapToVerifiedContactAddress: () => Promise<void>;

  // Crawl & Safety Settings
  updateCrawlSettings: (
    partial: Partial<
      LiveCrawlSettings & {
        liveEtherscanCrawlEnabled: boolean;
        preferLiveTigerGraphRestpp: boolean;
      }
    >
  ) => void;
}

const INITIAL_FEED: FeedLogEntry[] = [
  {
    id: 'feed-01',
    timestamp: '2026-10-28T13:02:14.000Z',
    payerAddress: WALLET_PERSONAS[1].address,
    payerLabel: WALLET_PERSONAS[1].shortTitle,
    amount: '250.00',
    asset: 'USDC',
    sourceChainName: 'Arbitrum',
    status: 'INTERCEPTED',
    verdict: 'INTERCEPTED_TAINT',
    hopDistance: 2,
    latencyMs: 2.94,
    executionSource: 'IN_MEMORY_GSQL_ENGINE',
    sha256Hash:
      '9f4a8d2c7e1b60395f82c1d4a70e3b98126c5d4f8a90b1e23c4d5f6a7b8c9d0e',
  },
  {
    id: 'feed-02',
    timestamp: '2026-10-28T12:58:40.000Z',
    payerAddress: WALLET_PERSONAS[2].address,
    payerLabel: WALLET_PERSONAS[2].shortTitle,
    amount: '250.00',
    asset: 'USDC',
    sourceChainName: 'Arbitrum',
    status: 'INTERCEPTED',
    verdict: 'INTERCEPTED_SYBIL',
    hopDistance: 2,
    latencyMs: 3.62,
    executionSource: 'IN_MEMORY_GSQL_ENGINE',
    sha256Hash:
      '3c1e7b9a4d20f8561e3c9b7a4d2f80156e3c9b7a4d20f8561e3c9b7a4d2f8015',
  },
  {
    id: 'feed-03',
    timestamp: '2026-10-28T12:49:11.000Z',
    payerAddress: WALLET_PERSONAS[0].address,
    payerLabel: WALLET_PERSONAS[0].shortTitle,
    amount: '250.00',
    asset: 'USDC',
    sourceChainName: 'Arbitrum',
    status: 'SETTLED',
    verdict: 'VERIFIED_CLEAN',
    hopDistance: null,
    bridgeUsed: 'Across Protocol (SOCKET V3)',
    latencyMs: 1.85,
    executionSource: 'IN_MEMORY_GSQL_ENGINE',
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

  linkConfig: DEFAULT_LINK_CONFIG,

  activePersonaId: 'persona-1',
  activePayerAddress: WALLET_PERSONAS[0].address,
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

  outboundCandidateInput: OUTBOUND_POISON_TEST_PRESETS[0].address,
  outboundExpectedMode: 'EVM_SOCKET',
  outboundScanResult: null,
  isScanningOutbound: false,

  paymentFeed: INITIAL_FEED,
  totalThreatsIntercepted: 14,
  lastMeasuredLatencyMs: 2.41,
  crawlSettings: {
    liveEtherscanCrawlEnabled: true,
    preferLiveTigerGraphRestpp: true,
    topFundersPerVertex: 5,
    maxApiCallsPerScan: 40,
    rateLimitRps: 3,
    crawlTimeoutMs: 10000,
    maxMainnetUsdCap: Number(process.env.NEXT_PUBLIC_MAX_MAINNET_USD ?? 5),
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
      let asset = state.linkConfig.asset;
      if (mode === 'BTC_SILENT_PAYMENT') {
        asset = 'BTC';
      } else if (mode === 'XMR_SUBADDRESS') {
        asset = 'XMR';
      } else if (asset === 'BTC' || asset === 'XMR') {
        asset = 'USDC';
      }

      return {
        linkConfig: {
          ...state.linkConfig,
          settlementMode: mode,
          asset,
        },
      };
    });
  },

  setVaultAddress: (mode, address) => {
    set((state) => ({
      linkConfig: {
        ...state.linkConfig,
        vaultAddresses: {
          ...state.linkConfig.vaultAddresses,
          [mode]: address,
        },
      },
    }));
  },

  setDestinationChainAndAsset: (chainId, asset) => {
    set((state) => ({
      linkConfig: {
        ...state.linkConfig,
        destinationChainId: chainId,
        asset,
      },
    }));
    void get().runFirewallAndQuotePipeline();
  },

  updateFirewallPolicy: (partial) => {
    set((state) => ({
      linkConfig: {
        ...state.linkConfig,
        policy: {
          ...state.linkConfig.policy,
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
    if (personaId === 'custom' && customAddress) {
      set({
        activePersonaId: 'custom',
        activePayerAddress: customAddress.trim(),
        selectedGraphNodeId: null,
        selectedGraphEdgeId: null,
      });
    } else {
      const found =
        WALLET_PERSONAS.find((p) => p.id === personaId) ?? WALLET_PERSONAS[0];
      set({
        activePersonaId: found.id,
        activePayerAddress: found.address,
        payerChainId: found.defaultChainId as SupportedEvmChainId,
        payerTokenSymbol: found.defaultTokenSymbol,
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
    const targetWallet = state.activePayerAddress;
    const { linkConfig, payerChainId, payerTokenSymbol, crawlSettings } = state;

    set({
      isScanning: true,
      scannerStep: 1,
      scanError: null,
      activeQuote: null,
    });

    try {
      set({ scannerStep: 2 });
      const scanRes = await fetch('/api/firewall/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetWallet,
          merchantWallet: linkConfig.vaultAddresses.EVM_SOCKET,
          chainId: payerChainId,
          policy: linkConfig.policy,
          crawlSettings,
          includeGemini: false,
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
        totalThreatsIntercepted: !scan.socketUnlocked
          ? prev.totalThreatsIntercepted + 1
          : prev.totalThreatsIntercepted,
      }));

      // Step 3: ONLY IF firewall unlocked SOCKET AND socketAutoBridgeEnabled is true, fetch SOCKET V3 Quote
      if (scan.socketUnlocked && linkConfig.policy.socketAutoBridgeEnabled) {
        set({ isLoadingQuote: true });

        const fromTokenCfg = EVM_TOKEN_REGISTRY[payerTokenSymbol];
        const destAssetKey =
          linkConfig.asset === 'ETH' || linkConfig.asset === 'USDT'
            ? linkConfig.asset
            : 'USDC';
        const toTokenCfg = EVM_TOKEN_REGISTRY[destAssetKey];

        const usdVal = Math.max(1, Number(linkConfig.amount) || 250);
        const tokenHumanAmount = usdVal / fromTokenCfg.approxUsdPrice;
        const inputAmountAtomic = toAtomicUnits(
          tokenHumanAmount,
          fromTokenCfg.decimals
        );

        const qs = new URLSearchParams({
          originChainId: String(payerChainId),
          destinationChainId: String(linkConfig.destinationChainId),
          inputToken: fromTokenCfg.addressesByChain[payerChainId],
          outputToken:
            toTokenCfg.addressesByChain[linkConfig.destinationChainId],
          inputAmount: inputAmountAtomic,
          userAddress: targetWallet,
          receiverAddress:
            linkConfig.vaultAddresses.EVM_SOCKET ||
            DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
          firewallEnabled: String(linkConfig.policy.firewallEnabled),
          maxHops: String(linkConfig.policy.maxHops),
          cleanLinkEnabled: String(linkConfig.policy.cleanLinkEnabled),
          unbundleEnabled: String(linkConfig.policy.unbundleEnabled),
          sybilBlockThreshold: String(linkConfig.policy.sybilBlockThreshold),
        });

        const quoteRes = await fetch(`/api/socket/quote?${qs.toString()}`);
        if (quoteRes.ok) {
          const quoteData: VeilPayQuoteResponse = await quoteRes.json();
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
          scan: activeScan,
          includeGemini: true,
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
        ?.shortName ?? 'Arbitrum';
    const bridgeName =
      state.activeQuote?.result.routes[0]?.bridgeDisplayName ??
      'Cake Wallet Vault';

    const newItem: FeedLogEntry = {
      id: `feed-${Date.now()}`,
      timestamp: new Date().toISOString(),
      payerAddress: state.activePayerAddress,
      payerLabel:
        WALLET_PERSONAS.find(
          (p) =>
            p.address.toLowerCase() === state.activePayerAddress.toLowerCase()
        )?.shortTitle ?? 'Custom Wallet',
      amount: state.linkConfig.amount,
      asset: state.linkConfig.asset,
      sourceChainName: sourceChain,
      status: state.activeScan.socketUnlocked ? 'SETTLED' : 'INTERCEPTED',
      verdict: state.activeScan.verdict,
      hopDistance: state.activeScan.minTaintHop,
      bridgeUsed: txHash
        ? `${bridgeName} (${txHash.slice(0, 10)}...)`
        : bridgeName,
      latencyMs: state.activeScan.executionTimeMs,
      executionSource: state.activeScan.executionSource,
      sha256Hash: state.activeReceipt.cryptographicAuditHash,
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
      const json = await res.json();
      const data: OutboundPoisonScanResult = json.result ?? json;
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
