'use client';

import React, { useEffect, useState } from 'react';
import {
  Shield,
  Lock,
  Copy,
  Check,
  ExternalLink,
  Layers,
  GitBranch,
  Shuffle,
  KeyRound,
  Ban,
  ShieldAlert,
} from 'lucide-react';
import { useAccount, useSignTypedData } from 'wagmi';
import { useVeilPayStore } from '@/store/veilpay-store';
import { isTestnetChain, SUPPORTED_EVM_CHAINS } from '@/lib/socket/tokens';
import {
  buildPaymentLinkTypedData,
  buildRevokeLinkTypedData,
  createPaymentLinkPayload,
} from '@/lib/links/eip712';
import { validateMultiProtocolAddress } from '@/lib/validators/address';
import type {
  HopDepth,
  LinkTrustLevel,
  PaymentAssetSymbol,
  SignedPaymentLinkPayload,
  SupportedEvmChainId,
  VaultSettlementMode,
} from '@/types/veilpay';

const HOP_OPTIONS: { value: HopDepth; label: string; tag?: string }[] = [
  { value: 1, label: '1 Hop' },
  { value: 2, label: '2 Hops' },
  { value: 3, label: '3 Hops', tag: 'DEFAULT' },
  { value: 4, label: '4 Hops' },
  { value: 5, label: '5 Hops' },
];

export function ReceiverSetupForm() {
  const {
    linkConfig,
    activeSignedLink,
    updateLinkConfig,
    setVaultMode,
    setVaultAddress,
    setDestinationChainAndAsset,
    updateFirewallPolicy,
    setActiveSignedLink,
    runFirewallAndQuotePipeline,
  } = useVeilPayStore();

  const { address: connectedReceiverAddress, isConnected } = useAccount();
  const { signTypedDataAsync, isPending: isSigningLink } = useSignTypedData();

  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('https://veilpay.xyz');
  const [linkActionError, setLinkActionError] = useState<string | null>(null);
  const [revokedNotice, setRevokedNotice] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const activeVaultAddress =
    linkConfig.vaultAddresses[linkConfig.settlementMode];
  const addressValidation = validateMultiProtocolAddress(
    activeVaultAddress,
    linkConfig.settlementMode
  );

  const shareableUrl =
    activeSignedLink?.c && activeSignedLink?.sig
      ? `${origin}/pay/${encodeURIComponent(activeSignedLink.payload.handle || 'goa.eth')}?c=${activeSignedLink.c}&sig=${activeSignedLink.sig}`
      : '';

  const handleCreateSignedLink = async () => {
    setLinkActionError(null);
    setRevokedNotice(null);
    if (!isConnected || !connectedReceiverAddress) {
      setLinkActionError(
        'Connect your receiver wallet (Reown AppKit) to sign this EIP-712 payment link.'
      );
      return;
    }
    if (!addressValidation.valid) {
      setLinkActionError(
        addressValidation.errorMessage ||
          'Enter a valid destination vault address for the selected settlement mode.'
      );
      return;
    }

    try {
      const payload = createPaymentLinkPayload({
        handle: linkConfig.handle || 'goa.eth',
        amount: linkConfig.amount || '250.00',
        asset: linkConfig.asset,
        destinationChainId: linkConfig.destinationChainId,
        settlementMode: linkConfig.settlementMode,
        vaultAddress: activeVaultAddress,
        policy: linkConfig.policy,
        signer: connectedReceiverAddress,
      });

      const sig = await signTypedDataAsync(buildPaymentLinkTypedData(payload));

      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, sig }),
      });
      const data = (await res.json()) as {
        error?: string;
        c?: string;
        sig?: `0x${string}`;
        url?: string;
        trustLevel?: LinkTrustLevel;
        payload?: SignedPaymentLinkPayload;
      };
      if (!res.ok || !data.c || !data.sig || !data.payload || !data.trustLevel) {
        throw new Error(data.error || 'Failed to register signed payment link.');
      }

      setActiveSignedLink({
        payload: data.payload,
        c: data.c,
        sig: data.sig,
        trustLevel: data.trustLevel,
        url: data.url,
      });
      await runFirewallAndQuotePipeline();
    } catch (err) {
      setLinkActionError(
        err instanceof Error
          ? err.message
          : 'Failed to sign EIP-712 PaymentLink.'
      );
    }
  };

  const handleRevokeSignedLink = async () => {
    setLinkActionError(null);
    setRevokedNotice(null);
    if (!activeSignedLink) return;
    if (!isConnected || !connectedReceiverAddress) {
      setLinkActionError(
        'Connect the original link signer wallet to sign the EIP-712 Revoke message.'
      );
      return;
    }

    try {
      const issuedAt = new Date().toISOString();
      const sig = await signTypedDataAsync(
        buildRevokeLinkTypedData({
          linkId: activeSignedLink.payload.linkId,
          signer: connectedReceiverAddress,
          issuedAt,
        })
      );

      const res = await fetch('/api/links/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkId: activeSignedLink.payload.linkId,
          signer: connectedReceiverAddress,
          issuedAt,
          sig,
        }),
      });
      const data = (await res.json()) as { error?: string; revoked?: boolean };
      if (!res.ok || !data.revoked) {
        throw new Error(data.error || 'Failed to revoke payment link.');
      }

      setRevokedNotice(
        `Link ${activeSignedLink.payload.linkId.slice(0, 12)}... revoked on server.`
      );
      setActiveSignedLink(null);
    } catch (err) {
      setLinkActionError(
        err instanceof Error ? err.message : 'Failed to revoke link.'
      );
    }
  };

  const handleCopyLink = async () => {
    if (!shareableUrl) return;
    try {
      await navigator.clipboard.writeText(shareableUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Section 1: Payment Link Handle, Amount & Target Settlement */}
      <div className="border border-[#262A33] bg-[#131519] p-4">
        <div className="mb-3 flex items-center justify-between border-b border-[#262A33] pb-2.5">
          <span className="font-mono text-xs font-semibold tracking-wider text-[#D97736] uppercase">
            01 // PAYMENT LINK &amp; ASSET TARGET
          </span>
          <span className="border border-[#262A33] bg-[#1A1D23] px-2 py-0.5 font-mono text-[10px] text-[#9499A3]">
            STATELESS ZERO-DOXX CONFIG
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block font-mono text-[11px] font-medium text-[#9499A3] uppercase">
              RECEIVER HANDLE
            </label>
            <div className="flex items-center border border-[#262A33] bg-[#1A1D23] px-2.5 py-2 focus-within:border-[#D97736]">
              <span className="font-mono text-xs text-[#646973]">
                veilpay.xyz/pay/
              </span>
              <input
                type="text"
                value={linkConfig.handle}
                onChange={(e) =>
                  updateLinkConfig({
                    handle: e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''),
                  })
                }
                className="w-full bg-transparent font-mono text-xs font-semibold text-[#F3F1EC] focus:outline-none"
                placeholder="goa.eth"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-mono text-[11px] font-medium text-[#9499A3] uppercase">
              REQUESTED AMOUNT (USD EQUIVALENT)
            </label>
            <div className="flex items-center border border-[#262A33] bg-[#1A1D23] px-2.5 py-2 focus-within:border-[#D97736]">
              <span className="mr-1.5 font-mono text-xs font-semibold text-[#E5A93C]">
                $
              </span>
              <input
                type="text"
                value={linkConfig.amount}
                onChange={(e) => updateLinkConfig({ amount: e.target.value })}
                onBlur={() => void runFirewallAndQuotePipeline()}
                className="w-full bg-transparent font-mono text-xs font-semibold tabular-nums text-[#F3F1EC] focus:outline-none"
                placeholder="250.00"
              />
              <span className="font-mono text-[10px] text-[#9499A3]">USD</span>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {['50.00', '250.00', '1000.00', '5000.00'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    updateLinkConfig({ amount: preset });
                    void runFirewallAndQuotePipeline();
                  }}
                  className={`border px-2 py-0.5 font-mono text-[10px] tabular-nums transition-colors ${
                    linkConfig.amount === preset
                      ? 'border-[#D97736] bg-[#261810] text-[#E5A93C]'
                      : 'border-[#262A33] bg-[#1A1D23] text-[#9499A3] hover:text-[#F3F1EC]'
                  }`}
                >
                  ${Number(preset).toLocaleString()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Settlement Asset & Destination EVM Chain */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block font-mono text-[11px] font-medium text-[#9499A3] uppercase">
              SETTLEMENT ASSET
            </label>
            <div className="grid grid-cols-5 gap-1">
              {(
                ['USDC', 'USDT', 'ETH', 'BTC', 'XMR'] as PaymentAssetSymbol[]
              ).map((asset) => {
                const isSelected = linkConfig.asset === asset;
                const isDisallowedOnTestnet =
                  asset === 'USDT' &&
                  isTestnetChain(linkConfig.destinationChainId);
                return (
                  <button
                    key={asset}
                    type="button"
                    disabled={isDisallowedOnTestnet}
                    title={
                      isDisallowedOnTestnet
                        ? 'USDT is not supported on testnet chains'
                        : undefined
                    }
                    onClick={() => {
                      if (isDisallowedOnTestnet) return;
                      if (asset === 'BTC') {
                        setVaultMode('BTC_SILENT_PAYMENT');
                      } else if (asset === 'XMR') {
                        setVaultMode('XMR_SUBADDRESS');
                      } else {
                        setVaultMode('EVM_SOCKET');
                        setDestinationChainAndAsset(
                          linkConfig.destinationChainId,
                          asset
                        );
                      }
                    }}
                    className={`border py-1.5 font-mono text-xs font-semibold transition-colors ${
                      isDisallowedOnTestnet
                        ? 'cursor-not-allowed border-[#262A33] bg-[#131519] text-[#9499A3]/40 opacity-50'
                        : isSelected
                        ? 'border-[#D97736] bg-[#261810] text-[#E5A93C]'
                        : 'border-[#262A33] bg-[#1A1D23] text-[#9499A3] hover:text-[#F3F1EC]'
                    }`}
                  >
                    {asset}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="font-mono text-[11px] font-medium text-[#9499A3] uppercase">
                DESTINATION CHAIN (EVM / VAULT)
              </label>
              {isTestnetChain(linkConfig.destinationChainId) && (
                <span className="border border-[#D99B26]/60 bg-[#2B210D] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#E5A93C]">
                  TESTNET CHAIN
                </span>
              )}
            </div>
            <select
              value={linkConfig.destinationChainId}
              disabled={linkConfig.settlementMode !== 'EVM_SOCKET'}
              onChange={(e) =>
                setDestinationChainAndAsset(
                  Number(e.target.value) as SupportedEvmChainId,
                  linkConfig.asset
                )
              }
              className="w-full border border-[#262A33] bg-[#1A1D23] px-2.5 py-2 font-mono text-xs text-[#F3F1EC] focus:border-[#D97736] focus:outline-none disabled:opacity-50"
            >
              <optgroup label="Mainnet Networks (SOCKET V3 Live)">
                {SUPPORTED_EVM_CHAINS.filter((c) => !c.isTestnet).map(
                  (chain) => (
                    <option key={chain.chainId} value={chain.chainId}>
                      {chain.name} (Chain ID: {chain.chainId})
                    </option>
                  )
                )}
              </optgroup>
              <optgroup label="Testnet Networks (Sepolia / Amoy)">
                {SUPPORTED_EVM_CHAINS.filter((c) => c.isTestnet).map(
                  (chain) => (
                    <option key={chain.chainId} value={chain.chainId}>
                      [TESTNET] {chain.name} (Chain ID: {chain.chainId})
                    </option>
                  )
                )}
              </optgroup>
            </select>
          </div>
        </div>
      </div>

      {/* Section 2: Cake Wallet Default Destination Vault Card */}
      <div className="border border-[#D97736]/50 bg-[#131519] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#262A33] pb-2.5">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#D97736]" />
            <span className="font-mono text-xs font-semibold tracking-wider text-[#F3F1EC] uppercase">
              02 // CAKE WALLET DESTINATION VAULT
            </span>
          </div>
          <span className="border border-[#D97736] bg-[#261810] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#E5A93C] uppercase">
            DEFAULT PRIVACY VAULT
          </span>
        </div>

        <div className="space-y-2">
          {(
            [
              {
                mode: 'EVM_SOCKET' as VaultSettlementMode,
                title:
                  'Mode 1: Multi-Chain EVM (Auto-Bridged via SOCKET to Cake Wallet)',
                subtitle:
                  'Accepts any EVM token on Arbitrum/OP/Polygon/Eth and settles cleanly to Cake Wallet EVM vault.',
                tag: 'SOCKET V3 ACTIVE',
              },
              {
                mode: 'BTC_SILENT_PAYMENT' as VaultSettlementMode,
                title:
                  'Mode 2: Bitcoin Silent Payments (BIP-352 sp1... Zero-Reuse)',
                subtitle:
                  'Generates non-reusable one-time taproot outputs via BIP-321 QR/URI after firewall clearance.',
                tag: 'BIP-352 / BIP-321',
              },
              {
                mode: 'XMR_SUBADDRESS' as VaultSettlementMode,
                title: 'Mode 3: Monero Subaddress (RingCT 888... Stealth Vault)',
                subtitle:
                  'Shielded RingCT + stealth subaddress URI unlocked strictly after TigerGraph clears payer.',
                tag: 'MONERO SUBADDRESS',
              },
            ] as const
          ).map((item) => {
            const active = linkConfig.settlementMode === item.mode;
            return (
              <button
                key={item.mode}
                type="button"
                onClick={() => setVaultMode(item.mode)}
                className={`w-full border p-3 text-left transition-all ${
                  active
                    ? 'border-[#D97736] bg-[#261810]/70'
                    : 'border-[#262A33] bg-[#1A1D23] hover:border-[#363B47]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#F3F1EC]">
                    {item.title}
                  </span>
                  <span
                    className={`border px-1.5 py-0.5 font-mono text-[10px] ${
                      active
                        ? 'border-[#E5A93C]/60 bg-[#D97736]/20 text-[#E5A93C]'
                        : 'border-[#262A33] text-[#9499A3]'
                    }`}
                  >
                    {item.tag}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#9499A3]">{item.subtitle}</p>
              </button>
            );
          })}
        </div>

        {/* Vault Destination Address Inspector */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <label className="font-mono text-[11px] font-medium text-[#9499A3] uppercase">
              CAKE WALLET RECEIVING ADDRESS ({linkConfig.settlementMode})
            </label>
            <span
              className={`font-mono text-[10px] ${
                addressValidation.valid ? 'text-[#1F9D68]' : 'text-[#D6453A]'
              }`}
            >
              {addressValidation.valid
                ? `✓ VALID ${addressValidation.detectedProtocol}`
                : '✗ INVALID FORMAT / CHECKSUM'}
            </span>
          </div>
          <input
            type="text"
            value={activeVaultAddress}
            onChange={(e) =>
              setVaultAddress(linkConfig.settlementMode, e.target.value.trim())
            }
            className="w-full border border-[#262A33] bg-[#0B0C0E] px-2.5 py-2 font-mono text-[11px] text-[#F3F1EC] focus:border-[#D97736] focus:outline-none"
          />
          {!addressValidation.valid && addressValidation.errorMessage && (
            <p className="mt-1 font-mono text-[11px] text-[#D6453A]">
              {addressValidation.errorMessage}
            </p>
          )}
        </div>
      </div>

      {/* Section 3: TigerGraph Pre-Flight Firewall Policy Controls */}
      <div className="border border-[#262A33] bg-[#131519] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#262A33] pb-2.5">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[#1F9D68]" />
            <span className="font-mono text-xs font-semibold tracking-wider text-[#F3F1EC] uppercase">
              03 // TIGERGRAPH PRE-FLIGHT FIREWALL POLICY
            </span>
          </div>
          <span
            className={`border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
              linkConfig.policy.firewallEnabled
                ? 'border-[#1F9D68]/60 bg-[#0E291E] text-[#1F9D68]'
                : 'border-[#D99B26]/60 bg-[#2B210D] text-[#D99B26]'
            }`}
          >
            {linkConfig.policy.firewallEnabled
              ? 'FIREWALL ENFORCING'
              : 'POLICY BYPASSED (ADVISORY)'}
          </span>
        </div>

        {/* Master Toggle */}
        <div className="flex items-center justify-between border border-[#262A33] bg-[#1A1D23] p-3">
          <div>
            <div className="font-mono text-xs font-semibold text-[#F3F1EC]">
              Block wallets within {linkConfig.policy.maxHops} hop
              {linkConfig.policy.maxHops > 1 ? 's' : ''} of a drainer / exploit
            </div>
            <p className="mt-0.5 text-xs text-[#9499A3]">
              Executes pre-sign multi-hop backward graph traversal before SOCKET
              quote generation.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={linkConfig.policy.firewallEnabled}
            onClick={() =>
              updateFirewallPolicy({
                firewallEnabled: !linkConfig.policy.firewallEnabled,
              })
            }
            className={`relative inline-flex h-6 w-12 shrink-0 cursor-pointer items-center border transition-colors ${
              linkConfig.policy.firewallEnabled
                ? 'border-[#1F9D68] bg-[#0E291E]'
                : 'border-[#262A33] bg-[#0B0C0E]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform transition-transform ${
                linkConfig.policy.firewallEnabled
                  ? 'translate-x-6 bg-[#1F9D68]'
                  : 'translate-x-1 bg-[#646973]'
              }`}
            />
          </button>
        </div>

        {/* Segmented Hop Depth Selector (1 to 5 Hops) */}
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="font-mono text-[11px] font-medium text-[#9499A3] uppercase">
              BACKWARD LINEAGE TRAVERSAL DEPTH (MAX_HOPS)
            </label>
            <span className="font-mono text-[11px] text-[#E5A93C]">
              ACTIVE: {linkConfig.policy.maxHops} HOP
              {linkConfig.policy.maxHops > 1 ? 'S' : ''}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {HOP_OPTIONS.map((hop) => {
              const active = linkConfig.policy.maxHops === hop.value;
              return (
                <button
                  key={hop.value}
                  type="button"
                  onClick={() => updateFirewallPolicy({ maxHops: hop.value })}
                  className={`flex flex-col items-center justify-center border py-2 font-mono text-xs transition-all ${
                    active
                      ? 'border-[#D97736] bg-[#261810] font-bold text-[#E5A93C]'
                      : 'border-[#262A33] bg-[#1A1D23] text-[#9499A3] hover:border-[#363B47] hover:text-[#F3F1EC]'
                  }`}
                >
                  <span>{hop.label}</span>
                  {hop.tag && (
                    <span className="mt-0.5 text-[9px] text-[#D97736]">
                      {hop.tag}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3 Sub-Engine Checkboxes */}
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-start justify-between gap-3 border border-[#262A33] bg-[#1A1D23] p-2.5 hover:border-[#363B47]">
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={linkConfig.policy.cleanLinkEnabled}
                onChange={(e) =>
                  updateFirewallPolicy({ cleanLinkEnabled: e.target.checked })
                }
                className="mt-0.5 h-4 w-4 accent-[#D97736]"
              />
              <div>
                <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#F3F1EC]">
                  <GitBranch className="h-3.5 w-3.5 text-[#D6453A]" />
                  CleanLink Taint Scan (OFAC / Drainer / Mixer Lineage)
                </div>
                <p className="text-[11px] text-[#9499A3]">
                  Traverses 1–{linkConfig.policy.maxHops} hops upstream for
                  Pink/Inferno Drainers, Tornado Cash, and Lazarus exploits.
                </p>
              </div>
            </div>
            <span className="font-mono text-[10px] text-[#1F9D68]">ACTIVE</span>
          </label>

          <div className="border border-[#262A33] bg-[#1A1D23] p-2.5">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={linkConfig.policy.unbundleEnabled}
                  onChange={(e) =>
                    updateFirewallPolicy({ unbundleEnabled: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 accent-[#D97736]"
                />
                <div>
                  <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#F3F1EC]">
                    <Layers className="h-3.5 w-3.5 text-[#D99B26]" />
                    Unbundle Sybil Guard (Shared Ancestor &amp; Cyclic Wash-Ring)
                  </div>
                  <p className="text-[11px] text-[#9499A3]">
                    Collapses sibling wallets funded by the same root mother
                    wallet and detects circular wash loops.
                  </p>
                </div>
              </div>
              <span className="font-mono text-[10px] text-[#E5A93C] tabular-nums">
                BLOCK &ge; {linkConfig.policy.sybilBlockThreshold}
              </span>
            </label>

            {linkConfig.policy.unbundleEnabled && (
              <div className="mt-2 flex items-center gap-3 border-t border-[#262A33] pt-2 pl-6">
                <span className="font-mono text-[10px] text-[#9499A3]">
                  SYBIL CLUSTER BLOCK THRESHOLD:
                </span>
                <input
                  type="range"
                  min={3}
                  max={30}
                  value={linkConfig.policy.sybilBlockThreshold}
                  onChange={(e) =>
                    updateFirewallPolicy({
                      sybilBlockThreshold: Number(e.target.value),
                    })
                  }
                  className="h-1.5 flex-1 cursor-pointer accent-[#D97736]"
                />
                <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93C]">
                  {linkConfig.policy.sybilBlockThreshold} Wallets
                </span>
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-start justify-between gap-3 border border-[#262A33] bg-[#1A1D23] p-2.5 hover:border-[#363B47]">
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={linkConfig.policy.socketAutoBridgeEnabled}
                onChange={(e) =>
                  updateFirewallPolicy({
                    socketAutoBridgeEnabled: e.target.checked,
                  })
                }
                className="mt-0.5 h-4 w-4 accent-[#D97736]"
              />
              <div>
                <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#F3F1EC]">
                  <Shuffle className="h-3.5 w-3.5 text-[#1F9D68]" />
                  SOCKET Cross-Chain Auto-Bridge (Accept Any Chain/Token)
                </div>
                <p className="text-[11px] text-[#9499A3]">
                  Fetches real-time Socket Swap V3 cross-chain routes only after
                  TigerGraph clears the payer.
                </p>
              </div>
            </div>
            <span className="font-mono text-[10px] text-[#1F9D68]">V3 API</span>
          </label>

          <div className="border border-[#262A33] bg-[#1A1D23] p-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#F3F1EC]">
                  <ShieldAlert className="h-3.5 w-3.5 text-[#E5A93C]" />
                  Inconclusive Lineage Fail-Closed Policy
                </div>
                <p className="text-[11px] text-[#9499A3]">
                  Action when unknown wallet crawl is truncated, times out, or lacks crawler API key.
                </p>
              </div>
              <div className="flex items-center gap-1 border border-[#262A33] bg-[#0B0C0E] p-0.5">
                <button
                  type="button"
                  onClick={() =>
                    updateFirewallPolicy({ inconclusivePolicy: 'BLOCK' })
                  }
                  className={`px-2 py-1 font-mono text-[10px] font-bold ${
                    (linkConfig.policy.inconclusivePolicy ?? 'BLOCK') === 'BLOCK'
                      ? 'border border-[#D97736] bg-[#261810] text-[#E5A93C]'
                      : 'text-[#9499A3] hover:text-[#F3F1EC]'
                  }`}
                >
                  BLOCK (FAIL CLOSED)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateFirewallPolicy({ inconclusivePolicy: 'WARN' })
                  }
                  className={`px-2 py-1 font-mono text-[10px] font-bold ${
                    linkConfig.policy.inconclusivePolicy === 'WARN'
                      ? 'border border-[#D99B26] bg-[#2B210D] text-[#D99B26]'
                      : 'text-[#9499A3] hover:text-[#F3F1EC]'
                  }`}
                >
                  WARN (PERMIT)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Live Stateless Payment Link Output Bar */}
      <div className="border border-[#D97736]/60 bg-[#131519] p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold text-[#E5A93C] uppercase">
            GENERATED ZERO-DOXX PAYMENT LINK (EIP-712 RECEIVER SIGNED)
          </span>
          <span className="font-mono text-[10px] text-[#9499A3]">
            {activeSignedLink
              ? `TRUST: ${activeSignedLink.trustLevel}`
              : 'SIGN WITH CONNECTED WALLET'}
          </span>
        </div>

        <p className="mb-2 font-mono text-[10px] text-[#9499A3]">
          Note: The handle is a human-readable label, not a verified identity.
          The EIP-712 signature proves which wallet signed the link and locks
          the destination vault and firewall policy hash.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1 overflow-hidden border border-[#262A33] bg-[#0B0C0E] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#F3F1EC]">
                veilpay.xyz/pay/{linkConfig.handle || 'goa.eth'}
              </span>
              <span className="truncate font-mono text-[10px] text-[#646973]">
                {shareableUrl ||
                  'Connect wallet & click Sign Link to generate ?c=...&sig=0x...'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleCreateSignedLink()}
              disabled={isSigningLink || !addressValidation.valid}
              className="flex items-center gap-1.5 border border-[#1F9D68] bg-[#0E291E] px-3 py-2 font-mono text-xs font-bold text-[#1F9D68] transition-colors hover:bg-[#1F9D68] hover:text-[#0B0C0E] disabled:opacity-50"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {isSigningLink ? 'SIGNING...' : 'SIGN LINK'}
            </button>

            <button
              type="button"
              onClick={() => void handleCopyLink()}
              disabled={!shareableUrl}
              className="flex items-center gap-1.5 border border-[#D97736] bg-[#D97736] px-3 py-2 font-mono text-xs font-bold text-[#0B0C0E] transition-colors hover:bg-[#E5A93C] disabled:opacity-50"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  COPIED
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  COPY LINK
                </>
              )}
            </button>

            {activeSignedLink && (
              <button
                type="button"
                onClick={() => void handleRevokeSignedLink()}
                disabled={isSigningLink}
                className="flex items-center gap-1 border border-[#D6453A] bg-[#2A1215] px-2.5 py-2 font-mono text-xs font-semibold text-[#D6453A] hover:bg-[#D6453A] hover:text-[#0B0C0E] disabled:opacity-50"
                title="Revoke Signed Payment Link (EIP-712 Revoke)"
              >
                <Ban className="h-3.5 w-3.5" />
                REVOKE
              </button>
            )}

            {shareableUrl && (
              <a
                href={shareableUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 border border-[#262A33] bg-[#1A1D23] px-2.5 py-2 font-mono text-xs text-[#F3F1EC] transition-colors hover:border-[#D97736]"
                title="Open Standalone Payer Checkout Route"
              >
                <ExternalLink className="h-3.5 w-3.5 text-[#E5A93C]" />
              </a>
            )}
          </div>
        </div>

        {linkActionError && (
          <div className="mt-2 font-mono text-[11px] text-[#D6453A]">
            {linkActionError}
          </div>
        )}
        {revokedNotice && (
          <div className="mt-2 font-mono text-[11px] text-[#E5A93C]">
            {revokedNotice}
          </div>
        )}
      </div>
    </div>
  );
}
