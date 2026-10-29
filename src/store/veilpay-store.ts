'use client';

import { create } from 'zustand';
import type {
  AigiForensicReceipt,
  ExecutionEngineSource,
  FirewallPolicyConfig,
  FirewallScanResult,
  HopDepth,
  LinkTrustLevel,
  LiveCrawlSettings,
  OutboundPoisonScanResult,
  PaymentAssetSymbol,
  SignedPaymentLinkPayload,
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
import {
  getInitialVaultAddresses,
  isDemoModeEnabled,
} from '@/lib/demo-fixtures';
import { DEFAULT_LINK_CONFIG } from '@/lib/utils/link-codec';
import { buildSimulatorSignedPreviewLink } from '@/lib/links/eip712';
import {
  EVM_TOKEN_REGISTRY,
  isTestnetChain,
  SUPPORTED_EVM_CHAINS,
  toAtomicUnits,
} from '@/lib/socket/tokens';
import {
  areAddressesMatchingSigner,
  evaluatePayerQuoteAndBroadcastEligibility,
} from '@/lib/session/proof-of-control';

export interface ActiveSignedLinkState {
  payload: SignedPaymentLinkPayload;
  c: string;
  sig: `0x${string}`;
  trustLevel: LinkTrustLevel;
  url?: string;
  manageToken?: string;
}

export type ActivePersonaId =
  | 'persona-1'
  | 'persona-2'
  | 'persona-3'
  | 'persona-4'
  | 'custom'
  | 'reown-connected';

export interface FeedLogEntry {
  id: string;
  timestamp: string;
  payerAddress: string;
  payerLabel: string;
  amount: string;
  asset: PaymentAssetSymbol;
  sourceChainName: string;
  status:
    | 'INTERCEPTED'
    | 'SETTLED'
    | 'BLOCKED'
    | 'ALLOWED'
    | 'PENDING'
    | 'CONFIRMED'
    | 'FAILED'
    | 'AWAITING_PAYMENT'
    | 'CLAIMED_UNVERIFIED';
  verdict: VerdictStatus;
  hopDistance: number | null;
  bridgeUsed?: string;
  latencyMs: number;
  executionSource: ExecutionEngineSource;
  sha256Hash: string;
  simulated?: boolean;
}

export interface VeilPayStoreState {
  // UI Navigation
  networkEnv: 'MAINNET' | 'TESTNET';
  activeLeftTab: 'LINK_BUILDER' | 'SAFE_SEND' | 'INCOMING_FEED';
  viewLayout: 'SPLIT' | 'RECEIVER_ONLY' | 'PAYER_ONLY';
  settingsDrawerOpen: boolean;
  settlementModalOpen: boolean;
  showRawGsqlInspector: boolean;

  // Receiver Payment Link Configuration
  linkConfig: VeilPayLinkConfig;
  activeSignedLink: ActiveSignedLinkState | null;
  linkVerificationError: string | null;

  // Payer Checkout Simulator State
  activePersonaId: ActivePersonaId;
  activePayerAddress: string;
  customAddressInput: string;
  payerChainId: SupportedEvmChainId;
  payerTokenSymbol: 'USDC' | 'USDT' | 'ETH';
  connectedWalletAddress: string | null;
  proofOfControlToken: string | null;
  proofOfControlVerifiedFor: string | null;

  // Firewall Scan, AIGI Receipt & SOCKET Quote
  activeScan: FirewallScanResult | null;
  activeReceipt: AigiForensicReceipt | null;
  activeQuote: VeilPayQuoteResponse | null;
  scanAttestation: string | null;
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
  setNetworkEnv: (env: 'MAINNET' | 'TESTNET') => void;
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
  setActiveSignedLink: (signed: ActiveSignedLinkState | null) => void;
  setLinkVerificationError: (error: string | null) => void;
  hydrateFromVerifiedLink: (
    signed: ActiveSignedLinkState,
    decoded: VeilPayLinkConfig
  ) => void;

  // Payer Actions
  selectPersona: (personaId: ActivePersonaId, customAddress?: string) => void;
  setCustomAddressInput: (input: string) => void;
  syncConnectedWallet: (address: string | null) => void;
  setProofOfControl: (
    token: string | null,
    verifiedForAddress: string | null
  ) => void;
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
  fetchEvents: () => Promise<void>;
}

export const useVeilPayStore = create<VeilPayStoreState>((set, get) => ({
  networkEnv: 'MAINNET',
  activeLeftTab: 'LINK_BUILDER',
  viewLayout: 'SPLIT',
  settingsDrawerOpen: false,
  settlementModalOpen: false,
  showRawGsqlInspector: false,

  linkConfig: DEFAULT_LINK_CONFIG,
  activeSignedLink: null,
  linkVerificationError: null,

  activePersonaId: 'persona-1',
  activePayerAddress: WALLET_PERSONAS[0].address,
  customAddressInput: '',
  payerChainId: 42161,
  payerTokenSymbol: 'USDC',
  connectedWalletAddress: null,
  proofOfControlToken: null,
  proofOfControlVerifiedFor: null,

  activeScan: null,
  activeReceipt: null,
  activeQuote: null,
  scanAttestation: null,
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

  paymentFeed: [],
  totalThreatsIntercepted: 0,
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

  setNetworkEnv: (env) => {
    set((state) => {
      const nextDestChain: SupportedEvmChainId =
        env === 'TESTNET' ? 84532 : 8453;
      const nextPayerChain: SupportedEvmChainId =
        env === 'TESTNET' ? 421614 : 42161;
      const demoVaults = getInitialVaultAddresses(undefined, env);

      return {
        networkEnv: env,
        payerChainId: nextPayerChain,
        activeSignedLink: null,
        linkConfig: {
          ...state.linkConfig,
          destinationChainId: nextDestChain,
          vaultAddresses: isDemoModeEnabled()
            ? demoVaults
            : state.linkConfig.vaultAddresses,
        },
      };
    });
    void get().runFirewallAndQuotePipeline();
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
      activeSignedLink: null,
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
        activeSignedLink: null,
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
      activeSignedLink: null,
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
      networkEnv: isTestnetChain(chainId) ? 'TESTNET' : 'MAINNET',
      activeSignedLink: null,
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
      activeSignedLink: null,
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
    set({
      networkEnv: isTestnetChain(decoded.destinationChainId)
        ? 'TESTNET'
        : 'MAINNET',
      activeSignedLink: null,
      linkConfig: decoded,
    });
    void get().runFirewallAndQuotePipeline();
  },

  setActiveSignedLink: (signed) => {
    set({ activeSignedLink: signed, linkVerificationError: null });
  },

  setLinkVerificationError: (error) => {
    set({ linkVerificationError: error });
  },

  hydrateFromVerifiedLink: (signed, decoded) => {
    set({
      networkEnv: isTestnetChain(decoded.destinationChainId)
        ? 'TESTNET'
        : 'MAINNET',
      activeSignedLink: signed,
      linkVerificationError: null,
      linkConfig: decoded,
    });
    void get().runFirewallAndQuotePipeline();
  },

  selectPersona: (personaId, customAddress) => {
    const state = get();
    const isTestnet = state.networkEnv === 'TESTNET';
    if (personaId === 'reown-connected' && customAddress) {
      const addr = customAddress.trim();
      const keepProof = areAddressesMatchingSigner(
        state.proofOfControlVerifiedFor,
        addr
      );
      set({
        activePersonaId: 'reown-connected',
        activePayerAddress: addr,
        proofOfControlToken: keepProof ? state.proofOfControlToken : null,
        proofOfControlVerifiedFor: keepProof
          ? state.proofOfControlVerifiedFor
          : null,
        activeQuote: null,
        selectedGraphNodeId: null,
        selectedGraphEdgeId: null,
      });
    } else if (personaId === 'custom' && customAddress) {
      set({
        activePersonaId: 'custom',
        activePayerAddress: customAddress.trim(),
        proofOfControlToken: null,
        proofOfControlVerifiedFor: null,
        activeQuote: null,
        selectedGraphNodeId: null,
        selectedGraphEdgeId: null,
      });
    } else {
      const found =
        WALLET_PERSONAS.find((p) => p.id === personaId) ?? WALLET_PERSONAS[0];
      const targetChainId: SupportedEvmChainId = isTestnet
        ? found.defaultChainId === 1
          ? 11155111
          : 421614
        : (found.defaultChainId as SupportedEvmChainId);
      set({
        activePersonaId: found.id,
        activePayerAddress: found.address,
        payerChainId: targetChainId,
        payerTokenSymbol: found.defaultTokenSymbol,
        proofOfControlToken: null,
        proofOfControlVerifiedFor: null,
        activeQuote: null,
        selectedGraphNodeId: null,
        selectedGraphEdgeId: null,
      });
    }
    void get().runFirewallAndQuotePipeline();
  },

  setCustomAddressInput: (input) => set({ customAddressInput: input }),

  syncConnectedWallet: (address) => {
    const state = get();
    const cleaned = address?.trim() || null;
    const stillMatchesProof = areAddressesMatchingSigner(
      cleaned,
      state.proofOfControlVerifiedFor
    );
    set({
      connectedWalletAddress: cleaned,
      proofOfControlToken: stillMatchesProof ? state.proofOfControlToken : null,
      proofOfControlVerifiedFor: stillMatchesProof
        ? state.proofOfControlVerifiedFor
        : null,
      activeQuote: stillMatchesProof ? state.activeQuote : null,
    });
  },

  setProofOfControl: (token, verifiedForAddress) => {
    set({
      proofOfControlToken: token,
      proofOfControlVerifiedFor: verifiedForAddress?.trim() || null,
    });
  },

  setPayerChainAndToken: (chainId, tokenSymbol) => {
    set({
      networkEnv: isTestnetChain(chainId) ? 'TESTNET' : 'MAINNET',
      payerChainId: chainId,
      payerTokenSymbol: tokenSymbol,
      proofOfControlToken: null,
      proofOfControlVerifiedFor: null,
      activeQuote: null,
    });
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
      scanAttestation: null,
    });

    try {
      set({ scannerStep: 2 });
      let signedLink = state.activeSignedLink;
      if (!signedLink) {
        const preview = await buildSimulatorSignedPreviewLink(linkConfig);
        signedLink = {
          payload: preview.payload,
          c: preview.c,
          sig: preview.sig,
          trustLevel:
            linkConfig.settlementMode === 'EVM_SOCKET' &&
            preview.payload.signer.toLowerCase() ===
              preview.payload.vaultAddress.toLowerCase()
              ? 'PROVEN'
              : 'SIGNED_UNPROVEN',
        };
        set({ activeSignedLink: signedLink });
      }

      const activeLinkId = signedLink.payload.linkId;
      const scanRes = await fetch('/api/firewall/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetWallet,
          chainId: payerChainId,
          linkId: activeLinkId,
          c: signedLink.c,
          sig: signedLink.sig,
          crawlSettings,
          includeGemini: false,
          proofOfControlToken: state.proofOfControlToken,
        }),
      });

      const scanJson = await scanRes.json();
      if (!scanRes.ok) {
        throw new Error(scanJson.error || 'Firewall scan failed');
      }

      const scan: FirewallScanResult = scanJson.scan;
      const receipt: AigiForensicReceipt = scanJson.receipt;
      const scanAttestation: string | null =
        typeof scanJson.scanAttestation === 'string'
          ? scanJson.scanAttestation
          : null;

      set((prev) => ({
        activeScan: scan,
        activeReceipt: receipt,
        scanAttestation,
        isScanning: false,
        scannerStep: 3,
        lastMeasuredLatencyMs: scan.executionTimeMs,
        totalThreatsIntercepted: !scan.socketUnlocked
          ? prev.totalThreatsIntercepted + 1
          : prev.totalThreatsIntercepted,
      }));

      // Issue 2, 3 & 4 Rules: Personas and pasted addresses stay scan-only.
      // Only fetch a quote when connected wallet == scanned wallet, proofOfControlToken is verified,
      // AND server scanAttestation is issued. Policy & vault are loaded server-side from the verified link.
      const latestState = get();
      const eligibility = evaluatePayerQuoteAndBroadcastEligibility({
        activePersonaId: latestState.activePersonaId,
        connectedAddress: latestState.connectedWalletAddress,
        scannedAddress: targetWallet,
        proofOfControlToken: latestState.proofOfControlToken,
      });

      if (
        scan.socketUnlocked &&
        signedLink.payload.policy.socketAutoBridgeEnabled &&
        Boolean(signedLink.payload.vaultAddress.trim()) &&
        eligibility.canQuote &&
        scanAttestation
      ) {
        set({ isLoadingQuote: true });

        const fromTokenCfg = EVM_TOKEN_REGISTRY[payerTokenSymbol];
        const destAssetKey =
          signedLink.payload.asset === 'ETH' || signedLink.payload.asset === 'USDT'
            ? signedLink.payload.asset
            : 'USDC';
        const toTokenCfg = EVM_TOKEN_REGISTRY[destAssetKey];

        const usdVal = Math.max(1, Number(signedLink.payload.amount) || 250);
        const tokenHumanAmount = usdVal / fromTokenCfg.approxUsdPrice;
        const inputAmountAtomic = toAtomicUnits(
          tokenHumanAmount,
          fromTokenCfg.decimals
        );

        const qs = new URLSearchParams({
          originChainId: String(payerChainId),
          destinationChainId: String(signedLink.payload.destinationChainId),
          inputToken: fromTokenCfg.addressesByChain[payerChainId],
          outputToken:
            toTokenCfg.addressesByChain[signedLink.payload.destinationChainId],
          inputAmount: inputAmountAtomic,
          userAddress: targetWallet,
          linkId: activeLinkId,
          c: signedLink.c,
          sig: signedLink.sig,
          scanAttestation,
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

    const isBtcXmr =
      state.linkConfig.settlementMode === 'BTC_SILENT_PAYMENT' ||
      state.linkConfig.settlementMode === 'XMR_SUBADDRESS';

    const status = isBtcXmr
      ? 'CLAIMED_UNVERIFIED'
      : state.activeScan.socketUnlocked
        ? 'SETTLED'
        : 'INTERCEPTED';

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
      status,
      verdict: state.activeScan.verdict,
      hopDistance: state.activeScan.minTaintHop,
      bridgeUsed: txHash
        ? `${bridgeName} (${txHash.slice(0, 10)}...)`
        : bridgeName,
      latencyMs: state.activeScan.executionTimeMs,
      executionSource: state.activeScan.executionSource,
      sha256Hash: state.activeReceipt.cryptographicAuditHash,
      simulated: true,
    };

    set((prev) => ({
      paymentFeed: [newItem, ...prev.paymentFeed],
    }));

    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'record_settlement',
        linkId: state.activeSignedLink?.payload.linkId ?? 'default',
        simulated: true,
        payerAddress: state.activePayerAddress,
        payerLabel: newItem.payerLabel,
        receiverVault:
          state.linkConfig.vaultAddresses[state.linkConfig.settlementMode],
        amount: state.linkConfig.amount,
        asset: state.linkConfig.asset,
        sourceChainId: state.payerChainId,
        sourceChainName: sourceChain,
        destinationChainId: state.linkConfig.destinationChainId,
        txHash,
        bridgeUsed: bridgeName,
        sha256Hash: state.activeReceipt.cryptographicAuditHash,
        settlementMode: state.linkConfig.settlementMode,
      }),
    }).catch(() => {});
  },

  fetchEvents: async () => {
    const state = get();
    const linkId = state.activeSignedLink?.payload.linkId;
    const url = linkId
      ? `/api/events?linkId=${encodeURIComponent(linkId)}`
      : '/api/events';
    try {
      const headers: Record<string, string> = {};
      if (state.activeSignedLink?.manageToken) {
        headers['x-manage-token'] = state.activeSignedLink.manageToken;
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.events)) {
          const feedEntries: FeedLogEntry[] = data.events.map((e: any) => ({
            id: e.id,
            timestamp: e.timestamp,
            payerAddress: e.payerAddress,
            payerLabel: e.payerLabel || 'Wallet',
            amount: e.amount,
            asset: e.asset,
            sourceChainName: e.sourceChainName,
            status: e.status,
            verdict: e.verdict ?? 'VERIFIED_CLEAN',
            hopDistance: e.hopDistance ?? null,
            bridgeUsed: e.bridgeUsed,
            latencyMs: e.latencyMs ?? 0,
            executionSource: e.executionSource ?? 'IN_MEMORY_GSQL_ENGINE',
            sha256Hash: e.sha256Hash ?? '',
            simulated: e.simulated,
          }));

          const nonSimulatedBlocked = feedEntries.filter(
            (e) =>
              !e.simulated &&
              (e.status === 'BLOCKED' || e.status === 'INTERCEPTED')
          ).length;

          set({
            paymentFeed: feedEntries,
            totalThreatsIntercepted: nonSimulatedBlocked,
          });
        }
      }
    } catch {
      // Non-blocking
    }
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
