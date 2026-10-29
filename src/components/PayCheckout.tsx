'use client';

import React, { useState, useEffect } from 'react';
import { isAddress } from 'viem';
import { useAccount, useSignMessage } from 'wagmi';
import { useVeilPayStore, type ActivePersonaId } from '@/store/veilpay-store';
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
import { VerdictBanner } from './VerdictBanner';
import { EvidencePanel } from './EvidencePanel';
import { RouteCard } from './RouteCard';
import type { SupportedEvmChainId } from '@/types/veilpay';

export function PayCheckout() {
  const {
    linkConfig,
    activeSignedLink,
    networkEnv,
    activePersonaId,
    activePayerAddress,
    customAddressInput,
    payerChainId,
    payerTokenSymbol,
    connectedWalletAddress,
    proofOfControlToken,
    activeScan,
    scanError,
    isScanning,
    scannerStep,
    judgeMode,
    selectPersona,
    setCustomAddressInput,
    syncConnectedWallet,
    setPayerChainAndToken,
    setProofOfControl,
    runFirewallAndQuotePipeline,
    setSettlementModalOpen,
    setVaultMode,
    updateFirewallPolicy,
  } = useVeilPayStore();

  const { isConnected, address: wagmiAddress } = useAccount();
  const { signMessageAsync, isPending: isSigningProof } = useSignMessage();
  const [proofError, setProofError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [demoState, setDemoState] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Sync connected wallet when wagmi changes
  useEffect(() => {
    syncConnectedWallet(isConnected && wagmiAddress ? wagmiAddress : null);
  }, [isConnected, wagmiAddress, syncConnectedWallet]);

  // Initial trigger to run scan & quote pipeline on mount
  useEffect(() => {
    if (!activeScan && !isScanning) {
      void runFirewallAndQuotePipeline();
    }
  }, [activeScan, isScanning, runFirewallAndQuotePipeline]);

  const isTestnet = networkEnv === 'TESTNET';
  const availableChains = SUPPORTED_EVM_CHAINS.filter(
    (c) => isTestnetChain(c.chainId) === isTestnet
  );

  const isBlocked =
    activeScan?.verdict === 'INTERCEPTED_TAINT' ||
    activeScan?.verdict === 'INTERCEPTED_SYBIL' ||
    activeScan?.verdict === 'INTERCEPTED_POISONING' ||
    (activeScan?.verdict === 'INCONCLUSIVE' &&
      linkConfig.policy.inconclusivePolicy === 'BLOCK');

  const canPay = !isBlocked && !scanError && !isScanning;

  const shortPayerAddress = activePayerAddress
    ? `${activePayerAddress.slice(0, 6)}…${activePayerAddress.slice(-4)}`
    : '—';

  const payerSourceLabel =
    activePersonaId === 'reown-connected'
      ? 'Connected wallet'
      : activePersonaId === 'custom'
      ? 'Custom wallet'
      : 'Demo wallet';

  const eligibility = evaluatePayerQuoteAndBroadcastEligibility({
    activePersonaId,
    connectedAddress: connectedWalletAddress,
    scannedAddress: activePayerAddress,
    proofOfControlToken,
  });

  const handleCustomScan = () => {
    const trimmed = customAddressInput.trim();
    if (!trimmed || !isAddress(trimmed)) {
      showToast('Enter a valid 42-character 0x EVM address');
      return;
    }
    selectPersona('custom', trimmed);
    void runFirewallAndQuotePipeline();
  };

  const handleDemoStateSelect = (val: string) => {
    setDemoState(val);
    if (!val) {
      // Auto from wallet
      selectPersona('persona-1');
      void runFirewallAndQuotePipeline();
      return;
    }

    if (val === 'warn') {
      selectPersona('persona-3');
      updateFirewallPolicy({ sybilBlockThreshold: 30 }); // Allow cluster of 24 with warning
      void runFirewallAndQuotePipeline();
    } else if (val === 'poison') {
      selectPersona('custom', '0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B');
      void runFirewallAndQuotePipeline();
    } else if (val === 'bypass') {
      selectPersona('persona-2');
      updateFirewallPolicy({ firewallEnabled: false });
      void runFirewallAndQuotePipeline();
    } else if (val === 'error') {
      useVeilPayStore.setState({
        scanError:
          'The history service didn’t respond in time. Nothing was sent. Retry the scan, or try again in a minute.',
        isScanning: false,
      });
    } else if (val === 'fallback') {
      selectPersona('persona-1');
      void runFirewallAndQuotePipeline();
    }
  };

  const handleSignProofOfControl = async () => {
    setProofError(null);
    if (!areAddressesMatchingSigner(connectedWalletAddress, activePayerAddress)) {
      setProofError('Connected wallet does not match the scanned payer address.');
      return;
    }

    try {
      const nonceRes = await fetch('/api/session/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkId: activeSignedLink?.payload.linkId || linkConfig.handle || 'default',
          vaultAddress:
            activeSignedLink?.payload.vaultAddress ||
            linkConfig.vaultAddresses[linkConfig.settlementMode] ||
            '',
          c: activeSignedLink?.c,
          sig: activeSignedLink?.sig,
          scannedAddress: activePayerAddress,
          chainId: payerChainId,
        }),
      });

      const nonceData = await nonceRes.json();
      if (!nonceRes.ok) {
        throw new Error(nonceData.error || 'Failed to request proof challenge nonce');
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
          vaultAddress: nonceData.vaultAddress,
          c: activeSignedLink?.c,
          sig: activeSignedLink?.sig,
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
      showToast('Wallet control verified');
    } catch (err) {
      setProofError(
        err instanceof Error ? err.message : 'Failed to sign proof of control.'
      );
    }
  };

  const destinationChainName = getChainDisplayName(linkConfig.destinationChainId);

  return (
    <section aria-label="Pay Checkout" className="space-y-3">
      {/* 1. Center Amount Hero Card */}
      <div className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-6 text-center">
        <div className="text-sm text-[#8ea5b4]">
          Paying{' '}
          <b className="text-[#eaf0f3] font-medium" id="hd">
            {linkConfig.handle || 'ansh-audit'}
          </b>
        </div>
        <div className="font-serif text-[56px] leading-tight my-1 text-[#eaf0f3]">
          ${Number(linkConfig.amount || 250).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          <small className="text-xl text-[#8ea5b4] ml-2 font-sans font-normal">
            {linkConfig.asset}
          </small>
        </div>
        <div className="text-sm text-[#8ea5b4]">
          to {destinationChainName} · arrives in about 3 seconds
        </div>
      </div>

      {/* 2. Testnet Sandbox Banner */}
      {isTestnet && (
        <div className="flex gap-2.5 items-center justify-between flex-wrap border border-[#e8c06a]/40 bg-[#e8c06a]/[0.08] rounded-xl px-3.5 py-2.5 text-[13.5px] text-[#e8c06a]">
          <span>Testnet sandbox: no real funds</span>
          <a
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noreferrer"
            className="text-[#efe6d2] underline hover:opacity-90"
          >
            Get free testnet USDC ↗
          </a>
        </div>
      )}

      {/* 3. Link Signature Verification Card (if signed link is present) */}
      {activeSignedLink && (
        <div className="bg-[#16252f] border border-[#27404f] rounded-2xl p-3.5 text-xs text-[#8ea5b4]">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[#7fd6b0] font-medium flex items-center gap-1.5">
              <span>✓</span> Signed payment link
            </span>
            <span className="text-[11px] border border-[#27404f] rounded-full px-2 py-0.5 text-[#eaf0f3]">
              Trust: {activeSignedLink.trustLevel}
            </span>
          </div>
          <div className="truncate">
            Signer:{' '}
            <span className="font-mono text-[#eaf0f3]">
              {activeSignedLink.payload.signer}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[#8ea5b4]">
            Receiver address and firewall rules verified against EIP-712 payload.
          </div>
        </div>
      )}

      {/* 4. Pay From Card */}
      <div className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5">
        <div className="text-sm text-[#8ea5b4] mb-2 font-medium">Pay from</div>

        <div className="flex justify-between items-center gap-2 mb-3">
          <b className="font-medium text-[#eaf0f3] font-mono text-sm">
            {shortPayerAddress}
          </b>
          <span className="text-xs border border-[#27404f] rounded-full px-2.5 py-0.5 text-[#8ea5b4]">
            {payerSourceLabel}
          </span>
        </div>

        {/* Chain and Token Row */}
        <div className="flex gap-2 flex-wrap mb-3">
          <select
            value={payerChainId}
            onChange={(e) => {
              const newChainId = Number(e.target.value) as SupportedEvmChainId;
              setPayerChainAndToken(newChainId, payerTokenSymbol);
              void runFirewallAndQuotePipeline();
            }}
            className="flex-1 min-w-[150px] bg-[#0f1a21] border border-[#27404f] rounded-xl px-3 py-2.5 text-sm text-[#eaf0f3] outline-none focus:border-[#efe6d2] transition-colors"
          >
            {availableChains.map((c) => (
              <option key={c.chainId} value={c.chainId}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={payerTokenSymbol}
            onChange={(e) => {
              const newToken = e.target.value as 'USDC' | 'USDT' | 'ETH';
              setPayerChainAndToken(payerChainId, newToken);
              void runFirewallAndQuotePipeline();
            }}
            className="w-28 bg-[#0f1a21] border border-[#27404f] rounded-xl px-3 py-2.5 text-sm text-[#eaf0f3] outline-none focus:border-[#efe6d2] transition-colors"
          >
            <option value="USDC">USDC</option>
            <option value="USDT">USDT</option>
            <option value="ETH">ETH</option>
          </select>
        </div>

        {/* Custom Address Input + Scan */}
        <div className="flex gap-2 flex-wrap mb-2">
          <input
            type="text"
            value={customAddressInput}
            onChange={(e) => setCustomAddressInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomScan();
            }}
            placeholder="Check any wallet address (0x…)"
            className="flex-1 min-w-[200px] bg-[#0f1a21] border border-[#27404f] rounded-xl px-3 py-2.5 text-sm font-mono text-[#eaf0f3] outline-none focus:border-[#efe6d2] transition-colors"
          />
          <button
            type="button"
            onClick={handleCustomScan}
            disabled={isScanning}
            className="border-0 rounded-xl px-4 py-2.5 text-sm font-semibold cursor-pointer bg-[#1c2f3b] text-[#eaf0f3] hover:bg-[#27404f] transition-colors disabled:opacity-50"
          >
            {isScanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>

        {/* Connected Wallet Control Challenge if connected */}
        {isConnected && wagmiAddress && activePersonaId === 'reown-connected' && !eligibility.canBroadcast && (
          <div className="mt-3 p-3 bg-[#0f1a21] rounded-xl border border-[#27404f] text-xs">
            <div className="text-[#8ea5b4] mb-2">
              Prove control of this wallet to unlock transaction broadcast:
            </div>
            {proofError && (
              <div className="text-[#f28b7b] mb-2">{proofError}</div>
            )}
            <button
              type="button"
              disabled={isSigningProof}
              onClick={() => void handleSignProofOfControl()}
              className="border-0 rounded-lg px-3 py-1.5 text-xs font-semibold bg-[#efe6d2] text-[#14212a] cursor-pointer hover:opacity-90"
            >
              {isSigningProof ? 'Signing challenge…' : 'Sign proof-of-control in wallet'}
            </button>
          </div>
        )}

        {/* Demo Persona Chips (Always accessible or when Judge Mode is enabled) */}
        <div className="mt-4 pt-3 border-t border-[#27404f]">
          <div className="text-xs text-[#8ea5b4] mb-2">
            Try a demo wallet
          </div>
          <div className="flex gap-2 flex-wrap">
            {WALLET_PERSONAS.map((p) => {
              const isActive = activePersonaId === p.id;
              let shortLabel = 'Clean whale';
              if (p.id === 'persona-2') shortLabel = 'Drainer, 2 hops';
              if (p.id === 'persona-3') shortLabel = '24-wallet sybil ring';
              if (p.id === 'persona-4') shortLabel = 'Deep taint, 4 hops';

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    selectPersona(p.id as ActivePersonaId);
                    void runFirewallAndQuotePipeline();
                  }}
                  className={`border rounded-full py-1 px-3 text-xs cursor-pointer transition-colors ${
                    isActive
                      ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
                      : 'border-[#27404f] text-[#8ea5b4] hover:text-[#eaf0f3]'
                  }`}
                >
                  {shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5. Scanner Progress Steps */}
      {isScanning && (
        <div className="flex gap-1.5 mb-3 text-[13px] text-[#8ea5b4]">
          <span
            className={`flex-1 border-t-2 pt-1.5 transition-colors ${
              scannerStep >= 1
                ? 'border-[#efe6d2] text-[#eaf0f3]'
                : 'border-[#27404f]'
            }`}
          >
            Reading history
          </span>
          <span
            className={`flex-1 border-t-2 pt-1.5 transition-colors ${
              scannerStep >= 2
                ? 'border-[#efe6d2] text-[#eaf0f3]'
                : 'border-[#27404f]'
            }`}
          >
            Tracing funds
          </span>
          <span
            className={`flex-1 border-t-2 pt-1.5 transition-colors ${
              scannerStep >= 3
                ? 'border-[#efe6d2] text-[#eaf0f3]'
                : 'border-[#27404f]'
            }`}
          >
            Writing receipt
          </span>
        </div>
      )}

      {/* 6. Verdict Banner */}
      <VerdictBanner />

      {/* 7. Collapsed Evidence & Receipt Panel */}
      <EvidencePanel />

      {/* 8. Route Card */}
      <RouteCard />

      {/* 9. Primary Action Button */}
      <button
        type="button"
        disabled={!canPay}
        onClick={() => setSettlementModalOpen(true)}
        className="w-full py-4 text-[16.5px] rounded-2xl font-semibold cursor-pointer border-0 bg-[#efe6d2] text-[#14212a] hover:opacity-95 transition-opacity disabled:bg-[#1c2f3b] disabled:text-[#8ea5b4] disabled:cursor-not-allowed shadow-lg"
      >
        {canPay
          ? `Pay $${Number(linkConfig.amount || 250).toLocaleString(undefined, {
              minimumFractionDigits: 2,
            })}`
          : isBlocked
          ? 'Can’t pay with this wallet'
          : scanError
          ? 'Check required'
          : 'Checking wallet…'}
      </button>

      {/* 10. Secondary Mode Switch */}
      <button
        type="button"
        onClick={() => {
          setVaultMode('BTC_SILENT_PAYMENT');
          setSettlementModalOpen(true);
        }}
        className="border border-[#27404f] rounded-full py-1.5 px-4 text-xs text-[#8ea5b4] hover:text-[#eaf0f3] hover:border-[#efe6d2] block mx-auto cursor-pointer transition-colors"
      >
        Pay with Bitcoin or Monero instead
      </button>

      {/* 11. Demo State Selector (Matching Mockup & Images) */}
      <div className="text-center text-xs text-[#8ea5b4] mt-4 mb-2">
        Demo state:{' '}
        <select
          value={demoState}
          onChange={(e) => handleDemoStateSelect(e.target.value)}
          className="bg-[#0f1a21] border border-[#27404f] rounded-lg px-2.5 py-1 text-xs text-[#eaf0f3] outline-none ml-1.5 inline-block focus:border-[#efe6d2]"
        >
          <option value="">Auto from wallet</option>
          <option value="warn">warn</option>
          <option value="poison">poison</option>
          <option value="bypass">bypass</option>
          <option value="error">error</option>
          <option value="fallback">fallback</option>
        </select>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 bg-[#efe6d2] text-[#14212a] py-2 px-4 rounded-full font-semibold z-50 text-sm shadow-xl">
          {toastMessage}
        </div>
      )}
    </section>
  );
}
