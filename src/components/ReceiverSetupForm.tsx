'use client';

import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Copy,
  Check,
  ExternalLink,
  Layers,
  GitBranch,
  Shuffle,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { SUPPORTED_EVM_CHAINS } from '@/lib/socket/tokens';
import { buildShareablePaymentUrl } from '@/lib/utils/link-codec';
import { validateMultiProtocolAddress } from '@/lib/validators/address';
import type {
  HopDepth,
  SettlementAssetSymbol,
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
    updateLinkConfig,
    setVaultMode,
    setDestinationChainAndAsset,
    updateFirewallPolicy,
    runFirewallAndQuotePipeline,
  } = useVeilPayStore();

  const [copied, setCopied] = useState(false);

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://veilpay.xyz';
  const shareableUrl = buildShareablePaymentUrl(origin, linkConfig);

  const addressValidation = validateMultiProtocolAddress(
    linkConfig.receiverVaultAddress,
    linkConfig.vaultMode
  );

  const handleCopyLink = async () => {
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
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold tracking-wider text-[#D97736] uppercase">
              01 // PAYMENT LINK & ASSET TARGET
            </span>
          </div>
          <span className="border border-[#262A33] bg-[#1A1D23] px-2 py-0.5 font-mono text-[10px] text-[#9499A3]">
            STATELESS ZERO-DOXX CONFIG
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Payment Handle */}
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

          {/* Requested Amount USD */}
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
                value={linkConfig.amountUsd}
                onChange={(e) => {
                  updateLinkConfig({ amountUsd: e.target.value });
                }}
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
                    updateLinkConfig({ amountUsd: preset });
                    void runFirewallAndQuotePipeline();
                  }}
                  className={`border px-2 py-0.5 font-mono text-[10px] tabular-nums transition-colors ${
                    linkConfig.amountUsd === preset
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
                ['USDC', 'USDT', 'ETH', 'BTC', 'XMR'] as SettlementAssetSymbol[]
              ).map((asset) => {
                const isSelected = linkConfig.settlementAsset === asset;
                return (
                  <button
                    key={asset}
                    type="button"
                    onClick={() => {
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
                      isSelected
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
            <label className="mb-1 block font-mono text-[11px] font-medium text-[#9499A3] uppercase">
              DESTINATION CHAIN (EVM / VAULT)
            </label>
            <select
              value={linkConfig.destinationChainId}
              disabled={linkConfig.vaultMode !== 'EVM_SOCKET'}
              onChange={(e) =>
                setDestinationChainAndAsset(
                  Number(e.target.value),
                  linkConfig.settlementAsset
                )
              }
              className="w-full border border-[#262A33] bg-[#1A1D23] px-2.5 py-2 font-mono text-xs text-[#F3F1EC] focus:border-[#D97736] focus:outline-none disabled:opacity-50"
            >
              {SUPPORTED_EVM_CHAINS.map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>
                  {chain.name} (Chain ID: {chain.chainId})
                </option>
              ))}
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

        {/* 3 Settlement Vault Modes */}
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
            const active = linkConfig.vaultMode === item.mode;
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
              CAKE WALLET RECEIVING ADDRESS ({linkConfig.vaultMode})
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
            value={linkConfig.receiverVaultAddress}
            onChange={(e) =>
              updateLinkConfig({ receiverVaultAddress: e.target.value.trim() })
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
              linkConfig.firewallPolicy.masterEnabled
                ? 'border-[#1F9D68]/60 bg-[#0E291E] text-[#1F9D68]'
                : 'border-[#D99B26]/60 bg-[#2B210D] text-[#D99B26]'
            }`}
          >
            {linkConfig.firewallPolicy.masterEnabled
              ? 'FIREWALL ENFORCING'
              : 'POLICY BYPASSED (ADVISORY)'}
          </span>
        </div>

        {/* Master Toggle */}
        <div className="flex items-center justify-between border border-[#262A33] bg-[#1A1D23] p-3">
          <div>
            <div className="font-mono text-xs font-semibold text-[#F3F1EC]">
              Block wallets within {linkConfig.firewallPolicy.maxHops} hop
              {linkConfig.firewallPolicy.maxHops > 1 ? 's' : ''} of a drainer /
              exploit
            </div>
            <p className="mt-0.5 text-xs text-[#9499A3]">
              Executes pre-sign multi-hop backward graph traversal before SOCKET
              quote generation.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={linkConfig.firewallPolicy.masterEnabled}
            onClick={() =>
              updateFirewallPolicy({
                masterEnabled: !linkConfig.firewallPolicy.masterEnabled,
              })
            }
            className={`relative inline-flex h-6 w-12 shrink-0 cursor-pointer items-center border transition-colors ${
              linkConfig.firewallPolicy.masterEnabled
                ? 'border-[#1F9D68] bg-[#0E291E]'
                : 'border-[#262A33] bg-[#0B0C0E]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform transition-transform ${
                linkConfig.firewallPolicy.masterEnabled
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
              ACTIVE: {linkConfig.firewallPolicy.maxHops} HOP
              {linkConfig.firewallPolicy.maxHops > 1 ? 'S' : ''}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {HOP_OPTIONS.map((hop) => {
              const active = linkConfig.firewallPolicy.maxHops === hop.value;
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
          {/* CleanLink */}
          <label className="flex cursor-pointer items-start justify-between gap-3 border border-[#262A33] bg-[#1A1D23] p-2.5 hover:border-[#363B47]">
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={linkConfig.firewallPolicy.cleanLinkEnabled}
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
                  Traverses 1–{linkConfig.firewallPolicy.maxHops} hops upstream
                  for Pink/Inferno Drainers, Tornado Cash, and Lazarus exploits.
                </p>
              </div>
            </div>
            <span className="font-mono text-[10px] text-[#1F9D68]">ACTIVE</span>
          </label>

          {/* Unbundle Sybil Guard */}
          <div className="border border-[#262A33] bg-[#1A1D23] p-2.5">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={linkConfig.firewallPolicy.unbundleEnabled}
                  onChange={(e) =>
                    updateFirewallPolicy({ unbundleEnabled: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 accent-[#D97736]"
                />
                <div>
                  <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#F3F1EC]">
                    <Layers className="h-3.5 w-3.5 text-[#D99B26]" />
                    Unbundle Sybil Guard (Shared Ancestor & Cyclic Wash-Ring)
                  </div>
                  <p className="text-[11px] text-[#9499A3]">
                    Collapses sibling wallets funded by the same root mother
                    wallet and detects circular wash loops.
                  </p>
                </div>
              </div>
              <span className="font-mono text-[10px] text-[#E5A93C] tabular-nums">
                BLOCK &ge; {linkConfig.firewallPolicy.sybilBlockThreshold}
              </span>
            </label>

            {linkConfig.firewallPolicy.unbundleEnabled && (
              <div className="mt-2 flex items-center gap-3 border-t border-[#262A33] pt-2 pl-6">
                <span className="font-mono text-[10px] text-[#9499A3]">
                  SYBIL CLUSTER BLOCK THRESHOLD:
                </span>
                <input
                  type="range"
                  min={3}
                  max={30}
                  value={linkConfig.firewallPolicy.sybilBlockThreshold}
                  onChange={(e) =>
                    updateFirewallPolicy({
                      sybilBlockThreshold: Number(e.target.value),
                    })
                  }
                  className="h-1.5 flex-1 cursor-pointer accent-[#D97736]"
                />
                <span className="font-mono text-xs font-semibold tabular-nums text-[#E5A93C]">
                  {linkConfig.firewallPolicy.sybilBlockThreshold} Wallets
                </span>
              </div>
            )}
          </div>

          {/* SOCKET Auto-Bridge */}
          <label className="flex cursor-pointer items-start justify-between gap-3 border border-[#262A33] bg-[#1A1D23] p-2.5 hover:border-[#363B47]">
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={linkConfig.firewallPolicy.socketAutoBridgeEnabled}
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
        </div>
      </div>

      {/* Section 4: Live Stateless Payment Link Output Bar */}
      <div className="border border-[#D97736]/60 bg-[#131519] p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold text-[#E5A93C] uppercase">
            GENERATED ZERO-DOXX PAYMENT LINK
          </span>
          <span className="font-mono text-[10px] text-[#9499A3]">
            BASE64URL STATELESS PAYLOAD
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1 overflow-hidden border border-[#262A33] bg-[#0B0C0E] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#F3F1EC]">
                veilpay.xyz/pay/{linkConfig.handle || 'goa.eth'}
              </span>
              <span className="truncate font-mono text-[10px] text-[#646973]">
                {shareableUrl}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 border border-[#D97736] bg-[#D97736] px-3 py-2 font-mono text-xs font-bold text-[#0B0C0E] transition-colors hover:bg-[#E5A93C]"
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

            <a
              href={shareableUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 border border-[#262A33] bg-[#1A1D23] px-2.5 py-2 font-mono text-xs text-[#F3F1EC] transition-colors hover:border-[#D97736]"
              title="Open Standalone Payer Checkout Route"
            >
              <ExternalLink className="h-3.5 w-3.5 text-[#E5A93C]" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
