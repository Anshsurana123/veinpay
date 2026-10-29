'use client';

import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Unlock,
  Shuffle,
  Clock,
  Fuel,
  ArrowRight,
  AlertTriangle,
  Wallet,
  QrCode,
  KeyRound,
} from 'lucide-react';
import { useAccount, useSignMessage } from 'wagmi';
import { useVeilPayStore } from '@/store/veilpay-store';
import { WALLET_PERSONAS } from '@/lib/graph/seed-topologies';
import {
  getChainDisplayName,
  isTestnetChain,
  SUPPORTED_EVM_CHAINS,
} from '@/lib/socket/tokens';
import {
  areAddressesMatchingSigner,
  evaluatePayerQuoteAndBroadcastEligibility,
} from '@/lib/session/proof-of-control';
import { TopologicalGraphCanvas } from '@/components/TopologicalGraphCanvas';
import { AigiForensicReceiptCard } from '@/components/AigiForensicReceiptCard';
import type { SupportedEvmChainId } from '@/types/veilpay';

export function PayerCheckoutPanel() {
  const {
    linkConfig,
    activePersonaId,
    activePayerAddress,
    customAddressInput,
    payerChainId,
    payerTokenSymbol,
    connectedWalletAddress,
    proofOfControlToken,
    activeScan,
    activeQuote,
    isScanning,
    isLoadingQuote,
    selectPersona,
    setCustomAddressInput,
    syncConnectedWallet,
    setProofOfControl,
    setPayerChainAndToken,
    runFirewallAndQuotePipeline,
    setSettlementModalOpen,
  } = useVeilPayStore();

  const { address: wagmiAddress, isConnected } = useAccount();
  const { signMessageAsync, isPending: isSigningProof } = useSignMessage();
  const [proofError, setProofError] = useState<string | null>(null);

  useEffect(() => {
    syncConnectedWallet(isConnected && wagmiAddress ? wagmiAddress : null);
  }, [isConnected, wagmiAddress, syncConnectedWallet]);

  useEffect(() => {
    if (!activeScan && !isScanning) {
      void runFirewallAndQuotePipeline();
    }
  }, [activeScan, isScanning, runFirewallAndQuotePipeline]);

  const isBlocked = activeScan ? !activeScan.socketUnlocked : false;
  const primaryRoute = activeQuote?.result.routes[0];
  const eligibility = evaluatePayerQuoteAndBroadcastEligibility({
    activePersonaId,
    connectedAddress: connectedWalletAddress,
    scannedAddress: activePayerAddress,
    proofOfControlToken,
  });

  const handleSignProofOfControl = async () => {
    setProofError(null);
    if (!areAddressesMatchingSigner(connectedWalletAddress, activePayerAddress)) {
      setProofError(
        'Connected wallet does not match the scanned payer address.'
      );
      return;
    }

    try {
      const nonceRes = await fetch('/api/session/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkId: linkConfig.handle || 'default',
          scannedAddress: activePayerAddress,
          chainId: payerChainId,
        }),
      });
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok) {
        throw new Error(nonceData.error || 'Failed to request proof nonce');
      }

      const signature = await signMessageAsync({
        message: nonceData.message,
      });

      const verifyRes = await fetch('/api/session/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: nonceData.nonce,
          linkId: nonceData.linkId,
          scannedAddress: nonceData.scannedAddress,
          chainId: nonceData.chainId,
          expiresAt: nonceData.expiresAt,
          signature,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.valid || !verifyData.token) {
        throw new Error(
          verifyData.reason || 'Proof-of-control signature verification failed'
        );
      }

      setProofOfControl(verifyData.token, activePayerAddress);
      await runFirewallAndQuotePipeline();
    } catch (err) {
      setProofError(
        err instanceof Error
          ? err.message
          : 'Failed to sign Proof of Control challenge.'
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="border border-[#262A33] bg-[#131519] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262A33] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold tracking-wider uppercase text-[#D97736]">
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
              ${Number(linkConfig.amount || 0).toLocaleString()} USD →{' '}
              {linkConfig.asset} (
              {getChainDisplayName(linkConfig.destinationChainId)})
            </div>
          </div>
        </div>

        {/* 4-Persona Simulator Bar */}
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[11px] font-medium uppercase text-[#9499A3]">
              SELECT PAYER WALLET PERSONA (OR CONNECT REAL WALLET / PASTE CUSTOM)
            </span>
            <span className="font-mono text-[10px] text-[#E5A93C]">
              ACTIVE PAYER: {activePayerAddress.slice(0, 8)}...
              {activePayerAddress.slice(-6)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {WALLET_PERSONAS.map((persona) => {
              const isSelected =
                activePersonaId === persona.id &&
                activePayerAddress.toLowerCase() ===
                  persona.address.toLowerCase();

              const badgeStyle =
                persona.id === 'persona-1'
                  ? 'border-[#1F9D68]/50 text-[#1F9D68]'
                  : persona.id === 'persona-3'
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
                        {persona.shortTitle}
                      </span>
                      <span
                        className={`border px-1 py-0.5 font-mono text-[9px] uppercase ${badgeStyle}`}
                      >
                        {persona.id === 'persona-1'
                          ? 'CLEAN'
                          : persona.id === 'persona-3'
                            ? 'SYBIL'
                            : 'THREAT'}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[#E5A93C]">
                      {persona.shorthandDisplay}
                    </div>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11px] text-[#9499A3]">
                    {persona.description}
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
                    selectPersona('custom', customAddressInput.trim());
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
                  selectPersona('custom', customAddressInput.trim());
                }
              }}
              className="border border-[#D97736] bg-[#261810] px-3 py-1.5 font-mono text-xs font-semibold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E]"
            >
              SCAN
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:col-span-5">
            <select
              value={payerChainId}
              onChange={(e) =>
                setPayerChainAndToken(
                  Number(e.target.value) as SupportedEvmChainId,
                  payerTokenSymbol
                )
              }
              className="flex-1 border border-[#262A33] bg-[#1A1D23] px-2 py-1.5 font-mono text-xs text-[#F3F1EC] focus:border-[#D97736] focus:outline-none"
            >
              <optgroup label="Mainnet Networks">
                {SUPPORTED_EVM_CHAINS.filter((c) => !c.isTestnet).map((c) => (
                  <option key={c.chainId} value={c.chainId}>
                    Pay from: {c.shortName}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Testnet Networks (Sepolia / Amoy)">
                {SUPPORTED_EVM_CHAINS.filter((c) => c.isTestnet).map((c) => (
                  <option key={c.chainId} value={c.chainId}>
                    [TESTNET] Pay from: {c.shortName}
                  </option>
                ))}
              </optgroup>
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

        {/* Testnet Mode & Faucet Banner */}
        {(isTestnetChain(payerChainId) ||
          isTestnetChain(linkConfig.destinationChainId)) && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border border-[#D99B26]/60 bg-[#2B210D]/50 px-3 py-1.5 font-mono text-[11px]">
            <div className="flex items-center gap-2 text-[#E5A93C]">
              <span className="h-2 w-2 rounded-full bg-[#D99B26]" />
              <span className="font-bold">TESTNET SANDBOX ACTIVE:</span>
              <span className="text-[#F3F1EC]">
                {getChainDisplayName(payerChainId)} →{' '}
                {getChainDisplayName(linkConfig.destinationChainId)} (BIP-352
                tsp1... &amp; Sepolia/Amoy)
              </span>
            </div>
            <a
              href="https://faucet.circle.com/"
              target="_blank"
              rel="noreferrer"
              className="border border-[#D97736] bg-[#261810] px-2 py-0.5 text-[10px] font-bold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E]"
            >
              GET FREE TESTNET USDC (CIRCLE FAUCET) ↗
            </a>
          </div>
        )}

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
              : activeQuote?.source ?? 'UNLOCKED & VERIFIED'}
          </span>
        </div>

        {isBlocked ? (
          <div className="mt-3 space-y-3">
            <div className="border border-[#D6453A]/60 bg-[#0B0C0E] p-3 font-mono text-xs text-[#D6453A]">
              <div className="font-bold">
                FIREWALL INTERCEPT ENFORCED — CALLDATA GENERATION PREVENTED
              </div>
              <p className="mt-1 text-[11px] text-[#9499A3]">
                SOCKET Swap V3 quote fetching and Cake Wallet destination vault
                URIs (`0x...`, `sp1...`, `888...`) are cryptographically locked
                because the payer wallet failed the {linkConfig.policy.maxHops}
                -hop TigerGraph pre-flight policy ({activeScan?.verdict}).
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
          <div className="mt-3 space-y-3">
            {eligibility.isScanOnly && (
              <div className="flex flex-wrap items-center justify-between gap-2 border border-[#D99B26]/70 bg-[#2B210D]/60 p-3 font-mono text-xs">
                <div className="space-y-1">
                  <div className="font-bold text-[#E5A93C]">
                    SCAN-ONLY MODE — PROOF OF WALLET CONTROL REQUIRED FOR QUOTE &amp; BROADCAST
                  </div>
                  <p className="text-[11px] text-[#F3F1EC]">
                    {eligibility.reason}
                  </p>
                  {proofError && (
                    <p className="text-[11px] text-[#D6453A]">{proofError}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isConnected &&
                    wagmiAddress &&
                    !areAddressesMatchingSigner(
                      wagmiAddress,
                      activePayerAddress
                    ) && (
                      <button
                        type="button"
                        onClick={() =>
                          selectPersona('reown-connected', wagmiAddress)
                        }
                        className="border border-[#D97736] bg-[#261810] px-3 py-1.5 font-mono text-[11px] font-bold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E]"
                      >
                        SWITCH SCAN TO CONNECTED WALLET ({wagmiAddress.slice(0, 6)}
                        ...{wagmiAddress.slice(-4)})
                      </button>
                    )}

                  {activePersonaId === 'reown-connected' &&
                    areAddressesMatchingSigner(
                      connectedWalletAddress,
                      activePayerAddress
                    ) &&
                    !proofOfControlToken && (
                      <button
                        type="button"
                        disabled={isSigningProof}
                        onClick={() => void handleSignProofOfControl()}
                        className="flex items-center gap-1.5 border border-[#1F9D68] bg-[#1F9D68] px-3 py-1.5 font-mono text-[11px] font-bold text-[#0B0C0E] hover:bg-[#25b87b] disabled:opacity-50"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {isSigningProof
                          ? 'SIGNING CHALLENGE...'
                          : 'SIGN PROOF OF CONTROL'}
                      </button>
                    )}
                </div>
              </div>
            )}

            {isLoadingQuote ? (
              <div className="border border-[#262A33] bg-[#0B0C0E] p-3 font-mono text-xs text-[#E5A93C]">
                FETCHING REAL-TIME CROSS-CHAIN ROUTE...
              </div>
            ) : activeQuote?.source === 'UNSUPPORTED_ON_TESTNET' ? (
              <div className="border border-[#D6453A] bg-[#2D1412]/70 p-3 font-mono text-xs text-[#D6453A]">
                <div className="font-bold">UNSUPPORTED ON TESTNET</div>
                <p className="mt-1 text-[11px] text-[#F3F1EC]">
                  {activeQuote.fallbackReason ??
                    'Cross-chain testnet routing supports USDC only via Circle CCTP V2.'}
                </p>
              </div>
            ) : primaryRoute ? (
              <div className="grid grid-cols-2 gap-2 font-mono sm:grid-cols-4">
                <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-[#9499A3]">
                    <Shuffle className="h-3 w-3 text-[#1F9D68]" />
                    OPTIMAL BRIDGE
                  </div>
                  <div className="mt-0.5 text-xs font-bold text-[#F3F1EC]">
                    {primaryRoute.bridgeDisplayName}
                  </div>
                </div>

                <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
                  <div className="text-[10px] text-[#9499A3]">
                    NET RECEIVER OUTPUT
                  </div>
                  <div className="mt-0.5 text-xs font-bold tabular-nums text-[#1F9D68]">
                    {primaryRoute.outputAmountFormatted}
                  </div>
                </div>

                <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-[#9499A3]">
                    <Clock className="h-3 w-3 text-[#E5A93C]" />
                    EXPECTED FINALITY TIME
                  </div>
                  <div className="mt-0.5 text-xs font-bold tabular-nums text-[#F3F1EC]">
                    {activeQuote?.cctpRoute
                      ? `${activeQuote.cctpRoute.expectedTimeSeconds} sec (${activeQuote.cctpRoute.finalityMode})`
                      : `${primaryRoute.serviceTime} sec`}
                  </div>
                </div>

                <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-[#9499A3]">
                    <Fuel className="h-3 w-3 text-[#D97736]" />
                    {activeQuote?.cctpRoute ? 'CCTP BURN FEE' : 'NETWORK GAS FEE'}
                  </div>
                  <div className="mt-0.5 text-xs font-bold tabular-nums text-[#E5A93C]">
                    {activeQuote?.cctpRoute
                      ? `${activeQuote.cctpRoute.feeFormatted} USDC (${activeQuote.cctpRoute.protocolFeeBps} bps)`
                      : `$${primaryRoute.totalGasFeesInUsd.toFixed(4)} USD`}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={
                  !eligibility.canBroadcast ||
                  activeQuote?.source === 'UNSUPPORTED_ON_TESTNET'
                }
                onClick={() => setSettlementModalOpen(true)}
                className="flex flex-1 items-center justify-center gap-2 border border-[#1F9D68] bg-[#1F9D68] py-3 font-mono text-xs font-bold text-[#0B0C0E] transition-colors hover:bg-[#25b87b] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ShieldCheck className="h-4 w-4" />
                {!eligibility.canBroadcast
                  ? 'SCAN-ONLY MODE (CONNECT & SIGN PROOF OF CONTROL TO SETTLE)'
                  : linkConfig.settlementMode === 'EVM_SOCKET'
                    ? activeQuote?.source === 'CCTP_V2_TESTNET'
                      ? `SETTLE ${activeQuote.cctpRoute?.netAmountOutFormatted ?? linkConfig.amount} USDC NET VIA CIRCLE CCTP V2`
                      : `SETTLE $${linkConfig.amount} VIA SOCKET V3 TO CAKE WALLET VAULT`
                    : linkConfig.settlementMode === 'BTC_SILENT_PAYMENT'
                      ? `OPEN BITCOIN SILENT PAYMENT (BIP-352 sp1...) QR VAULT`
                      : `OPEN MONERO SUBADDRESS (888... RINGCT) QR VAULT`}
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                disabled={!eligibility.canBroadcast}
                onClick={() => setSettlementModalOpen(true)}
                className="flex items-center justify-center gap-1.5 border border-[#D97736] bg-[#261810] px-4 py-3 font-mono text-xs font-semibold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E] disabled:cursor-not-allowed disabled:opacity-40"
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
