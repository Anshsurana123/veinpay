'use client';

import React, { useEffect, useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
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

const HOP_NOTES: Record<HopDepth, string> = {
  1: 'Relaxed: 1 step back. Fast, but misses risks 2+ steps away.',
  2: 'Careful: 2 steps back.',
  3: 'Standard: traces 3 steps back for mixers, drainers and sybil rings.',
  4: 'Strict: 4 steps back.',
  5: 'Strictest: 5 steps back. May block more borderline wallets.',
};

export function LinkBuilder() {
  const {
    linkConfig,
    activeSignedLink,
    updateLinkConfig,
    setVaultMode,
    setVaultAddress,
    setDestinationChainAndAsset,
    updateFirewallPolicy,
    setActiveSignedLink,
    networkEnv,
    runFirewallAndQuotePipeline,
  } = useVeilPayStore();

  const { address: connectedReceiverAddress, isConnected } = useAccount();
  const { signTypedDataAsync, isPending: isSigningLink } = useSignTypedData();
  const { open: openAppKit } = useAppKit();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [origin, setOrigin] = useState('https://veilpay.xyz');
  const [linkActionError, setLinkActionError] = useState<string | null>(null);
  const [revokedNotice, setRevokedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const isTestnet = networkEnv === 'TESTNET';
  const availableChains = SUPPORTED_EVM_CHAINS.filter(
    (c) => isTestnetChain(c.chainId) === isTestnet
  );

  const activeVaultAddress =
    linkConfig.vaultAddresses[linkConfig.settlementMode] || '';

  const addressValidation = validateMultiProtocolAddress(
    activeVaultAddress,
    linkConfig.settlementMode
  );

  const shareableUrl =
    activeSignedLink?.c && activeSignedLink?.sig
      ? `${origin}/pay/${encodeURIComponent(
          activeSignedLink.payload.handle || 'goa.eth'
        )}?c=${activeSignedLink.c}&sig=${activeSignedLink.sig}`
      : `${origin}/pay/${encodeURIComponent(linkConfig.handle || 'handle')}`;

  const handleCreateSignedLink = async () => {
    setLinkActionError(null);
    setRevokedNotice(null);
    if (!isConnected || !connectedReceiverAddress) {
      setLinkActionError('Connect your receiver wallet to sign this payment link.');
      return;
    }
    if (!addressValidation.valid) {
      setLinkActionError(
        addressValidation.errorMessage ||
          'Enter a valid destination vault address for the selected payout mode.'
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
      showToast('Payment link signed & verified');
    } catch (err) {
      setLinkActionError(
        err instanceof Error ? err.message : 'Failed to sign EIP-712 payment link.'
      );
    }
  };

  const handleRevokeSignedLink = async () => {
    setLinkActionError(null);
    setRevokedNotice(null);
    if (!activeSignedLink) return;
    if (!isConnected || !connectedReceiverAddress) {
      setLinkActionError('Connect the link signer wallet to sign revocation.');
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
        `Link ${activeSignedLink.payload.linkId.slice(0, 12)}… revoked on server.`
      );
      setActiveSignedLink(null);
      showToast('Link revoked');
    } catch (err) {
      setLinkActionError(
        err instanceof Error ? err.message : 'Failed to revoke link.'
      );
    }
  };

  return (
    <section aria-label="Create Payment Link" className="space-y-6 pb-20">
      <div>
        <h1 className="font-serif text-[30px] leading-tight text-[#eaf0f3] mb-1 font-normal">
          Create a payment link
        </h1>
        <p className="text-sm text-[#8ea5b4]">
          Payers are screened before they can send. You get paid in your Cake Wallet.
        </p>
      </div>

      {/* Step 1: How much and in what? */}
      <div className="space-y-3">
        <h2 className="text-[15px] font-semibold text-[#eaf0f3]">
          1 · How much and in what?
        </h2>

        {/* Amount Input */}
        <label className="flex items-baseline gap-2 bg-[#16252f] border border-[#27404f] rounded-2xl p-3 px-4 focus-within:border-[#efe6d2] transition-colors">
          <em className="not-italic font-serif text-2xl text-[#8ea5b4]">$</em>
          <input
            type="text"
            value={linkConfig.amount}
            inputMode="decimal"
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9.]/g, '');
              updateLinkConfig({ amount: val });
            }}
            placeholder="0.00"
            className="bg-transparent border-0 outline-none font-serif text-[34px] text-[#eaf0f3] w-full"
          />
        </label>

        {/* Preset Amount Chips */}
        <div className="flex gap-2 flex-wrap">
          {['50', '250', '1000', '5000'].map((amt) => {
            const isMatch = linkConfig.amount === amt;
            return (
              <button
                key={amt}
                type="button"
                onClick={() => updateLinkConfig({ amount: amt })}
                className={`border rounded-full py-1.5 px-3.5 text-xs font-medium cursor-pointer transition-colors ${
                  isMatch
                    ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
                    : 'border-[#27404f] text-[#8ea5b4] hover:text-[#eaf0f3]'
                }`}
              >
                ${Number(amt).toLocaleString()}
              </button>
            );
          })}
        </div>

        {/* Asset Chips */}
        <div className="flex gap-2 flex-wrap">
          {(['USDC', 'USDT', 'ETH', 'BTC', 'XMR'] as PaymentAssetSymbol[]).map(
            (asset) => {
              const isMatch = linkConfig.asset === asset;
              return (
                <button
                  key={asset}
                  type="button"
                  onClick={() => updateLinkConfig({ asset })}
                  className={`border rounded-full py-1.5 px-3.5 text-xs font-medium cursor-pointer transition-colors ${
                    isMatch
                      ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
                      : 'border-[#27404f] text-[#8ea5b4] hover:text-[#eaf0f3]'
                  }`}
                >
                  {asset}
                </button>
              );
            }
          )}
        </div>

        {/* Handle input */}
        <input
          type="text"
          value={linkConfig.handle}
          onChange={(e) => {
            const clean = e.target.value.replace(/[^a-zA-Z0-9._-]/g, '');
            updateLinkConfig({ handle: clean });
          }}
          placeholder="handle (letters, numbers . _ -)"
          className="w-full bg-[#0f1a21] border border-[#27404f] rounded-xl px-3.5 py-2.5 text-sm text-[#eaf0f3] outline-none focus:border-[#efe6d2] transition-colors"
        />
      </div>

      {/* Step 2: How do you want to be paid? */}
      <div className="space-y-3">
        <h2 className="text-[15px] font-semibold text-[#eaf0f3]">
          2 · How do you want to be paid?
        </h2>

        {/* Payout Options */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setVaultMode('EVM_SOCKET')}
            className={`w-full flex gap-3 text-left p-3.5 rounded-xl border cursor-pointer transition-colors ${
              linkConfig.settlementMode === 'EVM_SOCKET'
                ? 'border-[#efe6d2] bg-[#1c2f3b]'
                : 'border-[#27404f] bg-[#16252f] hover:border-[#8ea5b4]'
            }`}
          >
            <i
              className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 ${
                linkConfig.settlementMode === 'EVM_SOCKET'
                  ? 'border-4 border-[#efe6d2]'
                  : 'border-[#27404f]'
              }`}
            />
            <div>
              <b className="block text-[14.5px] font-semibold text-[#eaf0f3]">
                Any crypto, auto-converted
              </b>
              <small className="text-xs text-[#8ea5b4]">
                Payers use any EVM chain. You receive in your EVM Cake Wallet.
              </small>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setVaultMode('BTC_SILENT_PAYMENT')}
            className={`w-full flex gap-3 text-left p-3.5 rounded-xl border cursor-pointer transition-colors ${
              linkConfig.settlementMode === 'BTC_SILENT_PAYMENT'
                ? 'border-[#efe6d2] bg-[#1c2f3b]'
                : 'border-[#27404f] bg-[#16252f] hover:border-[#8ea5b4]'
            }`}
          >
            <i
              className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 ${
                linkConfig.settlementMode === 'BTC_SILENT_PAYMENT'
                  ? 'border-4 border-[#efe6d2]'
                  : 'border-[#27404f]'
              }`}
            />
            <div>
              <b className="block text-[14.5px] font-semibold text-[#eaf0f3]">
                Bitcoin Silent Payments
              </b>
              <small className="text-xs text-[#8ea5b4]">
                A fresh one-time address for every payment (BIP-352).
              </small>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setVaultMode('XMR_SUBADDRESS')}
            className={`w-full flex gap-3 text-left p-3.5 rounded-xl border cursor-pointer transition-colors ${
              linkConfig.settlementMode === 'XMR_SUBADDRESS'
                ? 'border-[#efe6d2] bg-[#1c2f3b]'
                : 'border-[#27404f] bg-[#16252f] hover:border-[#8ea5b4]'
            }`}
          >
            <i
              className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 ${
                linkConfig.settlementMode === 'XMR_SUBADDRESS'
                  ? 'border-4 border-[#efe6d2]'
                  : 'border-[#27404f]'
              }`}
            />
            <div>
              <b className="block text-[14.5px] font-semibold text-[#eaf0f3]">
                Monero subaddress
              </b>
              <small className="text-xs text-[#8ea5b4]">
                Private sender, amount and settlement (RingCT).
              </small>
            </div>
          </button>
        </div>

        {/* Chain Selector for EVM Mode */}
        {linkConfig.settlementMode === 'EVM_SOCKET' && (
          <select
            value={linkConfig.destinationChainId}
            onChange={(e) => {
              const chainId = Number(e.target.value) as SupportedEvmChainId;
              setDestinationChainAndAsset(chainId, linkConfig.asset);
            }}
            className="w-full bg-[#0f1a21] border border-[#27404f] rounded-xl px-3.5 py-2.5 text-sm text-[#eaf0f3] outline-none focus:border-[#efe6d2] transition-colors"
          >
            {availableChains.map((c) => (
              <option key={c.chainId} value={c.chainId}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {/* Vault Address Input */}
        <div>
          <input
            type="text"
            value={activeVaultAddress}
            onChange={(e) => {
              setVaultAddress(linkConfig.settlementMode, e.target.value.trim());
            }}
            placeholder={
              linkConfig.settlementMode === 'EVM_SOCKET'
                ? 'Your Cake Wallet EVM address (0x…)'
                : linkConfig.settlementMode === 'BTC_SILENT_PAYMENT'
                ? 'Your Cake Wallet BIP-352 Silent Payment address (sp1…)'
                : 'Your Cake Wallet Monero subaddress (8…)'
            }
            className="w-full bg-[#0f1a21] border border-[#27404f] rounded-xl px-3.5 py-2.5 text-sm font-mono text-[#eaf0f3] outline-none focus:border-[#efe6d2] transition-colors"
          />

          <div
            className={`text-xs mt-1.5 ${
              addressValidation.valid ? 'text-[#7fd6b0]' : 'text-[#f28b7b]'
            }`}
          >
            {activeVaultAddress
              ? addressValidation.valid
                ? `✓ Valid ${linkConfig.settlementMode.replace(/_/g, ' ')} address`
                : `✕ ${addressValidation.errorMessage || 'Invalid address'}`
              : 'Enter a valid Cake Wallet destination address to receive payouts.'}
          </div>
        </div>
      </div>

      {/* Step 3: How careful should we be? */}
      <div className="space-y-3">
        <h2 className="text-[15px] font-semibold text-[#eaf0f3]">
          3 · How careful should we be?
        </h2>

        {/* Hop Depth Selector */}
        <div className="flex bg-[#16252f] border border-[#27404f] rounded-xl p-1 gap-1">
          {([1, 2, 3, 4, 5] as HopDepth[]).map((hop) => {
            const isMatch = linkConfig.policy.maxHops === hop;
            return (
              <button
                key={hop}
                type="button"
                onClick={() => updateFirewallPolicy({ maxHops: hop })}
                className={`flex-1 py-2 px-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  isMatch
                    ? 'bg-[#1c2f3b] text-[#eaf0f3]'
                    : 'text-[#8ea5b4] hover:text-[#eaf0f3]'
                }`}
              >
                {hop} hop{hop > 1 ? 's' : ''}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-[#8ea5b4]">
          {HOP_NOTES[linkConfig.policy.maxHops]}
        </div>

        {/* Fine-tune Rules Accordion */}
        <details className="bg-[#16252f] border border-[#27404f] rounded-xl p-4 text-xs">
          <summary className="cursor-pointer text-[#8ea5b4] hover:text-[#eaf0f3] font-medium list-none flex justify-between">
            <span>Fine-tune rules</span>
            <span className="font-mono">+</span>
          </summary>

          <div className="mt-3 space-y-3 pt-3 border-t border-[#27404f]">
            {/* Master Firewall Switch */}
            <div className="flex justify-between items-center gap-3">
              <div>
                <span className="font-medium text-[#eaf0f3]">Firewall on</span>
                <p className="text-[11px] text-[#8ea5b4] m-0">
                  Master switch. Off means checks run for telemetry but never block.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateFirewallPolicy({
                    firewallEnabled: !linkConfig.policy.firewallEnabled,
                  })
                }
                className={`w-9 h-5 rounded-full relative cursor-pointer border-0 transition-colors ${
                  linkConfig.policy.firewallEnabled
                    ? 'bg-[#7fd6b0]'
                    : 'bg-[#27404f]'
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${
                    linkConfig.policy.firewallEnabled
                      ? 'left-[19px] bg-[#14212a]'
                      : 'left-[3px] bg-[#eaf0f3]'
                  }`}
                />
              </button>
            </div>

            {/* Mixer & Drainer Switch */}
            <div className="flex justify-between items-center gap-3">
              <span className="text-[#eaf0f3]">
                Block mixer, sanctioned and drainer funds
              </span>
              <button
                type="button"
                onClick={() =>
                  updateFirewallPolicy({
                    cleanLinkEnabled: !linkConfig.policy.cleanLinkEnabled,
                  })
                }
                className={`w-9 h-5 rounded-full relative cursor-pointer border-0 transition-colors ${
                  linkConfig.policy.cleanLinkEnabled
                    ? 'bg-[#7fd6b0]'
                    : 'bg-[#27404f]'
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${
                    linkConfig.policy.cleanLinkEnabled
                      ? 'left-[19px] bg-[#14212a]'
                      : 'left-[3px] bg-[#eaf0f3]'
                  }`}
                />
              </button>
            </div>

            {/* Sybil Cluster Switch */}
            <div className="flex justify-between items-center gap-3">
              <span className="text-[#eaf0f3]">Block linked-wallet groups</span>
              <button
                type="button"
                onClick={() =>
                  updateFirewallPolicy({
                    unbundleEnabled: !linkConfig.policy.unbundleEnabled,
                  })
                }
                className={`w-9 h-5 rounded-full relative cursor-pointer border-0 transition-colors ${
                  linkConfig.policy.unbundleEnabled
                    ? 'bg-[#7fd6b0]'
                    : 'bg-[#27404f]'
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${
                    linkConfig.policy.unbundleEnabled
                      ? 'left-[19px] bg-[#14212a]'
                      : 'left-[3px] bg-[#eaf0f3]'
                  }`}
                />
              </button>
            </div>

            {/* Sybil Threshold Slider */}
            <div className="flex justify-between items-center gap-3">
              <span className="text-[#eaf0f3]">
                Group size to block:{' '}
                <b className="text-[#eaf0f3]">
                  {linkConfig.policy.sybilBlockThreshold}
                </b>{' '}
                wallets
              </span>
              <input
                type="range"
                min="3"
                max="30"
                value={linkConfig.policy.sybilBlockThreshold}
                onChange={(e) =>
                  updateFirewallPolicy({
                    sybilBlockThreshold: Number(e.target.value),
                  })
                }
                className="w-28 cursor-pointer accent-[#efe6d2]"
              />
            </div>
          </div>
        </details>
      </div>

      {/* Step 4: Sign link with EIP-712 */}
      <div className="space-y-3">
        <h2 className="text-[15px] font-semibold text-[#eaf0f3]">
          4 · Sign link with EIP-712
        </h2>

        <div className="bg-[#16252f] border border-[#27404f] rounded-2xl p-4 space-y-3 text-xs">
          <p className="text-[#8ea5b4] leading-relaxed m-0">
            VeilPay links are cryptographically signed with EIP-712. Payers verify
            that the payout vault and firewall rules cannot be altered by a man-in-the-middle.
          </p>

          {activeSignedLink ? (
            <div className="space-y-2 pt-2 border-t border-[#27404f]">
              <div className="flex items-center justify-between text-[#7fd6b0] font-medium">
                <span>✓ Link is active and signed</span>
                <span className="text-[11px] border border-[#27404f] rounded-full px-2 py-0.5 text-[#eaf0f3]">
                  Trust level: {activeSignedLink.trustLevel}
                </span>
              </div>
              <div className="text-[#8ea5b4] break-all">
                Signer: <span className="font-mono text-[#eaf0f3]">{activeSignedLink.payload.signer}</span>
              </div>
              <button
                type="button"
                onClick={() => void handleRevokeSignedLink()}
                className="border border-[#f28b7b]/40 text-[#f28b7b] rounded-xl px-3 py-1.5 cursor-pointer hover:bg-[#f28b7b]/10 transition-colors"
              >
                Revoke this link
              </button>
            </div>
          ) : isConnected && connectedReceiverAddress ? (
            <button
              type="button"
              disabled={isSigningLink || !addressValidation.valid}
              onClick={() => void handleCreateSignedLink()}
              className="w-full py-3.5 rounded-xl font-semibold bg-[#efe6d2] text-[#14212a] cursor-pointer hover:opacity-95 disabled:opacity-50 transition-opacity"
            >
              {isSigningLink ? 'Signing in wallet…' : 'Sign link with EIP-712'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openAppKit()}
              className="w-full py-3 rounded-xl font-medium bg-[#1c2f3b] text-[#eaf0f3] hover:bg-[#27404f] cursor-pointer"
            >
              Connect receiver wallet to sign
            </button>
          )}

          {linkActionError && (
            <div className="text-[#f28b7b] text-xs pt-1">{linkActionError}</div>
          )}
          {revokedNotice && (
            <div className="text-[#e8c06a] text-xs pt-1">{revokedNotice}</div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Bar */}
      <div className="sticky bottom-3 bg-[#efe6d2] text-[#14212a] rounded-2xl p-3 px-4 flex items-center justify-between gap-3 shadow-2xl z-20">
        <div className="min-w-0 flex-1">
          <small className="block text-[11px] opacity-70">Your link</small>
          <b className="block font-medium truncate text-sm">
            veilpay.xyz/pay/{linkConfig.handle || 'goa.eth'}
          </b>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(shareableUrl);
              showToast('Link copied to clipboard');
            }}
            className="border-0 rounded-xl px-3.5 py-2 text-xs font-semibold bg-[#14212a] text-[#efe6d2] cursor-pointer hover:opacity-90"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              window.open(shareableUrl, '_blank');
              showToast('Opened payment page');
            }}
            className="border-0 rounded-xl px-3.5 py-2 text-xs font-semibold bg-[#14212a] text-[#efe6d2] cursor-pointer hover:opacity-90"
          >
            Open
          </button>
        </div>
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
