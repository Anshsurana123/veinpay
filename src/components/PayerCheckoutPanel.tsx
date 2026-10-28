'use client';

import React, { useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  Shuffle,
  Clock,
  Fuel,
  ArrowRight,
  Search,
  AlertTriangle,
  Wallet,
  QrCode,
} from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { CANONICAL_PERSONAS } from '@/lib/graph/seed-topologies';
import { SUPPORTED_EVM_CHAINS } from '@/lib/socket/tokens';
import { TopologicalGraphCanvas } from '@/components/TopologicalGraphCanvas';
import { AigiForensicReceiptCard } from '@/components/AigiForensicReceiptCard';

export function PayerCheckoutPanel() {
  const {
    linkConfig,
    activePersonaId,
    activePayerAddress,
    customAddressInput,
    payerChainId,
    payerTokenSymbol,
    activeScan,
    activeQuote,
    isScanning,
    isLoadingQuote,
    selectPersona,
    setCustomAddressInput,
    setPayerChainAndToken,
    runFirewallAndQuotePipeline,
    setSettlementModalOpen,
  } = useVeilPayStore();

  // Trigger initial pre-flight scan on mount if not yet scanned
  useEffect(() => {
    if (!activeScan && !isScanning) {
      void runFirewallAndQuotePipeline();
    }
  }, [activeScan, isScanning, runFirewallAndQuotePipeline]);

  const isBlocked = activeScan?.blocked ?? false;
  const primaryRoute = activeQuote?.routes[0];

  return (
    <div className="space-y-4">
      {/* Payer Checkout Header Card */}
      <div className="border border-[#262A33] bg-[#131519] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262A33] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold tracking-wider text-[#D97736] uppercase">
                MODULE B // LIVE PAYER CHECKOUT &amp; PRE-SIGN FIREWALL
              </span>
              <span className="border border-[#D97736]/50 bg-[#261810] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#E5A93C]">
                veilpay.xyz/pay/{linkConfig.handle || 'goa.eth'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[#9499A3]">
              Every connecting wallet undergoes sub-50ms TigerGraph multi-hop
              lineage verification before SOCKET route generation.
            </p>
          </div>

          <div className="border border-[#262A33] bg-[#0B0C0E] px-3 py-1.5 text-right font-mono">
            <div className="text-[10px] text-[#9499A3]">AMOUNT DUE</div>
            <div className="text-sm font-bold tabular-nums text-[#E5A93C]">
              ${Number(linkConfig.amountUsd || 0).toLocaleString()} USD →{' '}
              {linkConfig.settlementAsset} ({linkConfig.destinationChainName})
            </div>
          </div>
        </div>

        {/* 4-Persona Simulator Bar */}
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[11px] font-medium text-[#9499A3] uppercase">
              SELECT PAYER WALLET PERSONA (OR CONNECT REAL WALLET / PASTE CUSTOM)
            </span>
            <span className="font-mono text-[10px] text-[#E5A93C]">
              ACTIVE PAYER: {activePayerAddress.slice(0, 8)}...
              {activePayerAddress.slice(-6)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {CANONICAL_PERSONAS.map((persona) => {
              const isSelected =
                activePersonaId === persona.id &&
                activePayerAddress.toLowerCase() ===
                  persona.address.toLowerCase();

              const badgeStyle =
                persona.badgeTone === 'jade'
                  ? 'border-[#1F9D68]/50 text-[#1F9D68]'
                  : persona.badgeTone === 'amber'
                    ? 'border-[#D99B26]/50 text-[#D99B26]'
                    : 'border-[#D6453A]/50 text-[#D6453A]';

              return (
                <button
                  key={persona.id}
                  type="button"
                  onClick={() => selectPersona(persona.id)}
                  className={`flex flex-col justify-between border p-2.5 text-left transition-all ${
                    isSelected
                      ? 'border-[#D97736] bg-[#261810]'
                      : 'border-[#262A33] bg-[#1A1D23] hover:border-[#363B47]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-xs font-bold text-[#F3F1EC]">
                        {persona.title}
                      </span>
                      <span
                        className={`border px-1 py-0.5 font-mono text-[9px] uppercase ${badgeStyle}`}
                      >
                        {persona.badgeTone === 'jade'
                          ? 'CLEAN'
                          : persona.badgeTone === 'amber'
                            ? 'SYBIL'
                            : 'THREAT'}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-[#E5A93C] tabular-nums">
                      {persona.shortAddress}
                    </div>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11px] text-[#9499A3]">
                    {persona.subtitle}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Wallet Address Crawl Bar + Payer Source Chain/Token */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-12">
          <div className="flex items-center gap-1.5 sm:col-span-7">
            <div className="flex flex-1 items-center border border-[#262A33] bg-[#0B0C0E] px-2.5 py-1.5 focus-within:border-[#D97736]">
              <Wallet className="mr-2 h-3.5 w-3.5 text-[#9499A3]" />
              <input
                type="text"
                value={customAddressInput}
                onChange={(e) => setCustomAddressInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customAddressInput.trim()) {
                    selectPersona('CUSTOM', customAddressInput.trim());
                  }
                }}
                placeholder="Scan any custom EVM address (live Etherscan V2 + GoPlus crawl)..."
                className="w-full bg-transparent font-mono text-xs text-[#F3F1EC] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                if (customAddressInput.trim()) {
                  selectPersona('CUSTOM', customAddressInput.trim());
                }
              }}
              className="border border-[#D97736] bg-[#261810] px-3 py-1.5 font-mono text-xs font-semibold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E]"
            >
              SCAN
            </button>
          </div>

          {/* Payer Source Chain & Token Selector */}
          <div className="flex items-center gap-1.5 sm:col-span-5">
            <select
              value={payerChainId}
              onChange={(e) =>
                setPayerChainAndToken(Number(e.target.value), payerTokenSymbol)
              }
              className="flex-1 border border-[#262A33] bg-[#1A1D23] px-2 py-1.5 font-mono text-xs text-[#F3F1EC] focus:border-[#D97736] focus:outline-none"
            >
              {SUPPORTED_EVM_CHAINS.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  Pay from: {c.name}
                </option>
              ))}
            </select>

            <select
              value={payerTokenSymbol}
              onChange={(e) =>
                setPayerChainAndToken(
                  payerChainId,
                  e.target.value as 'USDC' | 'USDT' | 'ETH'
                )
              }
              className="border border-[#262A33] bg-[#1A1D23] px-2 py-1.5 font-mono text-xs font-bold text-[#E5A93C] focus:border-[#D97736] focus:outline-none"
            >
              <option value="USDC">USDC</option>
              <option value="USDT">USDT</option>
              <option value="ETH">ETH</option>
            </select>
          </div>
        </div>

        {/* Shallow Scan Advisory Banner (Case 1: when max_hops == 1) */}
        {activeScan?.shallowScanAdvisory && (
          <div className="mt-3 flex items-center gap-2 border border-[#D99B26]/60 bg-[#2B210D]/50 px-3 py-2 font-mono text-[11px] text-[#D99B26]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{activeScan.shallowScanAdvisory}</span>
          </div>
        )}
      </div>

      {/* Module C: Interactive 2D Topological Graph Canvas */}
      <TopologicalGraphCanvas />

      {/* Module D: AIGI Forensic Security Verdict & Compliance Receipt */}
      <AigiForensicReceiptCard />

      {/* SOCKET Cross-Chain Quote & Cake Wallet Settlement Gate */}
      <div
        className={`border p-4 transition-all ${
          isBlocked
            ? 'border-[#D6453A] bg-[#2D1412]/40'
            : 'border-[#1F9D68] bg-[#0E291E]/30'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262A33] pb-3">
          <div className="flex items-center gap-2">
            {isBlocked ? (
              <Lock className="h-4 w-4 text-[#D6453A]" />
            ) : (
              <Unlock className="h-4 w-4 text-[#1F9D68]" />
            )}
            <span className="font-mono text-xs font-bold tracking-wider uppercase text-[#F3F1EC]">
              04 // SOCKET V3 CROSS-CHAIN ROUTING &amp; CAKE WALLET VAULT GATE
            </span>
          </div>

          <span
            className={`border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
              isBlocked
                ? 'border-[#D6453A] bg-[#2D1412] text-[#D6453A]'
                : 'border-[#1F9D68] bg-[#0E291E] text-[#1F9D68]'
            }`}
          >
            {isBlocked
              ? 'HARD-LOCKED PRE-SIGN'
              : activeQuote?.sourceStatus ?? 'UNLOCKED & VERIFIED'}
          </span>
        </div>

        {isBlocked ? (
          /* BLOCKED STATE: Hard-locked SOCKET button & redacted destination vault URIs */
          <div className="mt-3 space-y-3">
            <div className="border border-[#D6453A]/60 bg-[#0B0C0E] p-3 font-mono text-xs text-[#D6453A]">
              <div className="font-bold">
                FIREWALL INTERCEPT ENFORCED — CALLDATA GENERATION PREVENTED
              </div>
              <p className="mt-1 text-[11px] text-[#9499A3]">
                SOCKET Swap V3 quote fetching and Cake Wallet destination vault
                URIs (`0x...`, `sp1...`, `888...`) are cryptographically locked
                because the payer wallet failed the{' '}
                {linkConfig.firewallPolicy.maxHops}-hop TigerGraph pre-flight
                policy ({activeScan?.verdict}).
              </p>
            </div>

            <button
              type="button"
              disabled
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 border border-[#D6453A] bg-[#2D1412] py-3 font-mono text-xs font-bold text-[#D6453A] opacity-90"
            >
              <Lock className="h-4 w-4" />
              TRANSACTION BLOCKED BY TIGERGRAPH FIREWALL ({activeScan?.verdict})
            </button>
          </div>
        ) : (
          /* CLEAN / UNLOCKED STATE: Live SOCKET Swap V3 Route + Cake Wallet Vault Settlement */
          <div className="mt-3 space-y-3">
            {isLoadingQuote ? (
              <div className="border border-[#262A33] bg-[#0B0C0E] p-3 font-mono text-xs text-[#E5A93C]">
                FETCHING REAL-TIME SOCKET SWAP V3 CROSS-CHAIN ROUTE...
              </div>
            ) : primaryRoute ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono">
                <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-[#9499A3]">
                    <Shuffle className="h-3 w-3 text-[#1F9D68]" />
                    OPTIMAL BRIDGE
                  </div>
                  <div className="mt-0.5 text-xs font-bold text-[#F3F1EC]">
                    {primaryRoute.bridgeProtocolName}
                  </div>
                </div>

                <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
                  <div className="text-[10px] text-[#9499A3]">
                    ESTIMATED OUTPUT
                  </div>
                  <div className="mt-0.5 text-xs font-bold tabular-nums text-[#1F9D68]">
                    {primaryRoute.estimatedOutputFormatted}{' '}
                    {linkConfig.settlementAsset}
                  </div>
                </div>

                <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-[#9499A3]">
                    <Clock className="h-3 w-3 text-[#E5A93C]" />
                    EST. SETTLEMENT TIME
                  </div>
                  <div className="mt-0.5 text-xs font-bold tabular-nums text-[#F3F1EC]">
                    ~{primaryRoute.serviceTime} sec
                  </div>
                </div>

                <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-[#9499A3]">
                    <Fuel className="h-3 w-3 text-[#D97736]" />
                    NETWORK GAS FEE
                  </div>
                  <div className="mt-0.5 text-xs font-bold tabular-nums text-[#E5A93C]">
                    ${primaryRoute.totalGasFeesInUsd.toFixed(4)} USD
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setSettlementModalOpen(true)}
                className="flex flex-1 items-center justify-center gap-2 border border-[#1F9D68] bg-[#1F9D68] py-3 font-mono text-xs font-bold text-[#0B0C0E] transition-colors hover:bg-[#25b87b]"
              >
                <ShieldCheck className="h-4 w-4" />
                {linkConfig.vaultMode === 'EVM_SOCKET'
                  ? `SETTLE $${linkConfig.amountUsd} VIA SOCKET V3 TO CAKE WALLET VAULT`
                  : linkConfig.vaultMode === 'BTC_SILENT_PAYMENT'
                    ? `OPEN BITCOIN SILENT PAYMENT (BIP-352 sp1...) QR VAULT`
                    : `OPEN MONERO SUBADDRESS (888... RINGCT) QR VAULT`}
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setSettlementModalOpen(true)}
                className="flex items-center justify-center gap-1.5 border border-[#D97736] bg-[#261810] px-4 py-3 font-mono text-xs font-semibold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E]"
              >
                <QrCode className="h-4 w-4" />
                BTC / XMR QR VAULT
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
