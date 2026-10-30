'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useAccount } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { useVeilPayStore } from '@/store/veilpay-store';
import {
  buildBip321SilentPaymentUri,
  buildLegacySilentPaymentUri,
  buildMoneroPaymentUri,
} from '@/lib/validators/address';
import {
  EVM_TOKEN_REGISTRY,
  getChainDisplayName,
  getChainExplorerUrl,
  isTestnetChain,
} from '@/lib/socket/tokens';
import { useCctpTransfer } from '@/hooks/useCctpTransfer';
import { useSettlementFlow } from '@/hooks/useSettlementFlow';
import type { VaultSettlementMode } from '@/types/veilpay';

export function SettlementSheet() {
  const {
    settlementModalOpen,
    setSettlementModalOpen,
    linkConfig,
    activeSignedLink,
    payerChainId,
    payerTokenSymbol,
    setVaultMode,
    activeScan,
    activeQuote,
    crawlSettings,
    recordSimulatedSettlement,
    spotRates,
    ratesError,
    fetchRates,
    networkEnv,
    activePersonaId,
    selectPersona,
  } = useVeilPayStore();

  const { address: connectedWallet, isConnected } = useAccount();
  const { open: openAppKit } = useAppKit();

  const [btcLegacyFormat, setBtcLegacyFormat] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const isBtcMode = linkConfig.settlementMode === 'BTC_SILENT_PAYMENT';
  const isXmrMode = linkConfig.settlementMode === 'XMR_SUBADDRESS';
  const isEvmMode = linkConfig.settlementMode === 'EVM_SOCKET';

  const isTestnet = networkEnv === 'TESTNET';

  // Fetch Oracle rates when sheet opens
  useEffect(() => {
    if (settlementModalOpen && !spotRates) {
      void fetchRates();
    }
  }, [settlementModalOpen, spotRates, fetchRates]);

  const primaryRoute = activeQuote?.result?.routes?.[0];
  const inputTokenAddress =
    EVM_TOKEN_REGISTRY[payerTokenSymbol]?.addressesByChain[payerChainId] ?? null;

  // CCTP V2 hook for testnet
  const {
    activeTransfer: cctpTransfer,
    startBurnTransfer,
    completeMintOnDestination,
    isBusy: isCctpBusy,
  } = useCctpTransfer({
    linkId: linkConfig.handle,
    receiverVaultAddress: linkConfig.vaultAddresses.EVM_SOCKET,
  });

  // Standard EVM settlement hook
  const {
    step: settlementStep,
    requiresApproval,
    isNativeToken,
    spenderAddress,
    approveIfNeededAndSend,
    errorMessage: settlementFlowError,
  } = useSettlementFlow({
    route: primaryRoute,
    originChainId: payerChainId,
    inputTokenAddress,
    ownerAddress: connectedWallet ?? null,
    enabled:
      settlementModalOpen &&
      isEvmMode &&
      activeQuote?.source !== 'CCTP_V2_TESTNET',
    onConfirmed: (hash) => {
      setDoneMessage(`Sent. Tx ${hash.slice(0, 8)}…${hash.slice(-6)}`);
      recordSimulatedSettlement(hash);
      void fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify_receipt',
          txHash: hash,
          sourceChainId: payerChainId,
          settlementMode: linkConfig.settlementMode,
          receiverVault: linkConfig.vaultAddresses.EVM_SOCKET,
          simulated: false,
          linkId: activeSignedLink?.payload.linkId ?? 'default',
        }),
      }).catch(() => {});
    },
  });

  // Rates calculation
  const btcRate = spotRates?.rates?.BTC ?? null;
  const xmrRate = spotRates?.rates?.XMR ?? null;
  const isRateAvailable = isBtcMode
    ? Boolean(btcRate && !ratesError)
    : isXmrMode
    ? Boolean(xmrRate && !ratesError)
    : true;

  const amountNum = Math.max(0.01, Number(linkConfig.amount) || 250);
  const amountBtc = btcRate ? (amountNum / btcRate).toFixed(8) : '';
  const amountXmr = xmrRate ? (amountNum / xmrRate).toFixed(6) : '';

  const spAddress = linkConfig.vaultAddresses.BTC_SILENT_PAYMENT || '';
  const xmrSubaddress = linkConfig.vaultAddresses.XMR_SUBADDRESS || '';

  const bip321Uri =
    spAddress && isRateAvailable && amountBtc
      ? buildBip321SilentPaymentUri({
          spAddress,
          amountBtc,
          label: `VeilPay:${linkConfig.handle}`,
          message: `VeilPay Clean Settlement ($${linkConfig.amount} USD @ $${btcRate?.toLocaleString()} BTC/USD)`,
        })
      : '';

  const legacyBtcUri =
    spAddress && isRateAvailable && amountBtc
      ? buildLegacySilentPaymentUri({
          spAddress,
          amountBtc,
          label: `VeilPay:${linkConfig.handle}`,
        })
      : '';

  const xmrUri =
    xmrSubaddress && isRateAvailable && amountXmr
      ? buildMoneroPaymentUri({
          subaddress: xmrSubaddress,
          amountXmr,
          recipientName: `VeilPay:${linkConfig.handle}`,
          description: `VeilPay Clean Settlement ($${linkConfig.amount} USD @ $${xmrRate?.toLocaleString()} XMR/USD)`,
        })
      : '';

  const activeUri = isBtcMode
    ? btcLegacyFormat
      ? legacyBtcUri
      : bip321Uri
    : isXmrMode
    ? xmrUri
    : '';

  // Generate QR code for BTC / XMR
  useEffect(() => {
    if (!settlementModalOpen || !activeUri) {
      setQrDataUrl('');
      return;
    }
    let mounted = true;
    QRCode.toDataURL(activeUri, {
      width: 220,
      margin: 1,
      color: {
        dark: '#14212a',
        light: '#efe6d2',
      },
    })
      .then((url) => {
        if (mounted) setQrDataUrl(url);
      })
      .catch(() => {
        if (mounted) setQrDataUrl('');
      });

    return () => {
      mounted = false;
    };
  }, [settlementModalOpen, activeUri]);

  if (!settlementModalOpen) return null;

  const handleClose = () => {
    setDoneMessage(null);
    setSettlementModalOpen(false);
  };

  const isExceedingSafetyCap =
    !isTestnet &&
    isEvmMode &&
    Number(linkConfig.amount) > (crawlSettings.maxMainnetUsdCap ?? 5);

  const handleRunSimulation = () => {
    const fakeHash = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;
    recordSimulatedSettlement(fakeHash);
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verify_receipt',
        txHash: fakeHash,
        sourceChainId: payerChainId,
        settlementMode: linkConfig.settlementMode,
        receiverVault:
          linkConfig.vaultAddresses[linkConfig.settlementMode] || 'unconfigured',
        simulated: true,
        linkId: activeSignedLink?.payload.linkId ?? 'default',
      }),
    }).catch(() => {});
    setDoneMessage('Simulated settlement logged. No funds moved.');
  };

  const handleUnverifiedClaim = () => {
    recordSimulatedSettlement();
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verify_receipt',
        settlementMode: linkConfig.settlementMode,
        receiverVault:
          linkConfig.vaultAddresses[linkConfig.settlementMode] || 'unconfigured',
        simulated: false,
        linkId: activeSignedLink?.payload.linkId ?? 'default',
      }),
    }).catch(() => {});
    setDoneMessage(
      'Payment claimed. Recorded as awaiting on-chain verification in activity log.'
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 bg-[#050a0e]/80 flex items-end sm:items-center justify-center z-50 p-2 sm:p-4 backdrop-blur-sm"
    >
      <div className="bg-[#16252f] border border-[#27404f] rounded-[22px] w-full max-w-[560px] max-h-[92vh] overflow-y-auto p-5 shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-serif text-[22px] text-[#eaf0f3] font-normal">
            Finish payment
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="border border-[#27404f] rounded-full py-1 px-3 text-xs text-[#8ea5b4] hover:text-[#eaf0f3] cursor-pointer transition-colors"
          >
            Close
          </button>
        </div>

        {/* Firewall Status Banner */}
        <div className="rounded-xl p-2.5 px-3.5 flex items-center gap-2.5 mb-3 bg-[#7fd6b0]/[0.09] border border-[#7fd6b0]/[0.35]">
          <div className="w-5 h-5 rounded-full grid place-items-center font-bold text-xs bg-[#7fd6b0] text-[#14212a] shrink-0">
            ✓
          </div>
          <p className="text-xs text-[#eaf0f3] m-0">
            Wallet cleared by the firewall{isTestnet ? ' · testnet' : ''}
          </p>
        </div>

        {/* Done State Display */}
        {doneMessage ? (
          <div className="space-y-4">
            <div className="rounded-2xl p-4 flex gap-3.5 bg-[#7fd6b0]/[0.09] border border-[#7fd6b0]/[0.35]">
              <div className="w-8 h-8 rounded-full grid place-items-center font-bold text-[#14212a] bg-[#7fd6b0] shrink-0">
                ✓
              </div>
              <div>
                <h4 className="text-base font-semibold text-[#eaf0f3] mb-1">
                  Settlement recorded
                </h4>
                <p className="text-xs text-[#8ea5b4] leading-relaxed">
                  {doneMessage}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="w-full py-3.5 rounded-xl font-semibold bg-[#efe6d2] text-[#14212a] cursor-pointer hover:opacity-95"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Mode Segmented Control */}
            <div className="flex bg-[#0f1a21] border border-[#27404f] rounded-xl p-1 mb-3.5 gap-1">
              <button
                type="button"
                onClick={() => setVaultMode('EVM_SOCKET')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  isEvmMode
                    ? 'bg-[#1c2f3b] text-[#eaf0f3]'
                    : 'text-[#8ea5b4] hover:text-[#eaf0f3]'
                }`}
              >
                Any chain
              </button>
              <button
                type="button"
                onClick={() => setVaultMode('BTC_SILENT_PAYMENT')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  isBtcMode
                    ? 'bg-[#1c2f3b] text-[#eaf0f3]'
                    : 'text-[#8ea5b4] hover:text-[#eaf0f3]'
                }`}
              >
                Bitcoin
              </button>
              <button
                type="button"
                onClick={() => setVaultMode('XMR_SUBADDRESS')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  isXmrMode
                    ? 'bg-[#1c2f3b] text-[#eaf0f3]'
                    : 'text-[#8ea5b4] hover:text-[#eaf0f3]'
                }`}
              >
                Monero
              </button>
            </div>

            {/* EVM Mode Content */}
            {isEvmMode && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
                    Bridge
                    <b className="block text-[#eaf0f3] text-[14.5px] font-medium mt-0.5 truncate">
                      {isTestnet
                        ? 'Testnet relay (CCTP V2)'
                        : primaryRoute?.usedBridgeNames?.[0] ?? 'Across (Socket V3)'}
                    </b>
                  </div>
                  <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
                    Receiver gets
                    <b className="block text-[#eaf0f3] text-[14.5px] font-medium mt-0.5">
                      {primaryRoute?.toAmount
                        ? Number(primaryRoute.toAmount).toFixed(2)
                        : linkConfig.amount}{' '}
                      {linkConfig.asset}
                    </b>
                  </div>
                </div>

                {/* Technical Details Accordion */}
                <details className="bg-[#0f1a21] border border-[#27404f] rounded-xl p-3 text-xs">
                  <summary className="cursor-pointer text-[#8ea5b4] hover:text-[#eaf0f3] font-medium list-none flex justify-between">
                    <span>Technical details</span>
                    <span className="font-mono">+</span>
                  </summary>
                  <p className="font-mono text-[11px] text-[#8ea5b4] mt-2 break-all leading-relaxed">
                    Router:{' '}
                    {primaryRoute?.txData?.object?.to ??
                      (linkConfig.vaultAddresses.EVM_SOCKET ||
                      '0x3a23F9…c1b0')}
                    <br />
                    Calldata:{' '}
                    {primaryRoute?.txData?.object?.data
                      ? `${primaryRoute.txData.object.data.slice(0, 16)}… (${
                          primaryRoute.txData.object.data.length / 2
                        } bytes)`
                      : '0x2e9d… (shown for pre-sign audit)'}
                  </p>
                </details>

                {/* Safety Cap Banner */}
                {isExceedingSafetyCap && (
                  <div className="rounded-xl border border-[#e8c06a]/40 bg-[#e8c06a]/[0.08] p-3 text-xs text-[#e8c06a] leading-relaxed">
                    Safety cap: live payments are limited to $
                    {crawlSettings.maxMainnetUsdCap.toFixed(2)}. Run a simulation,
                    or switch to Testnet.
                  </div>
                )}

                {/* Error Banner */}
                {settlementFlowError && (
                  <div className="rounded-xl border border-[#f28b7b]/40 bg-[#f28b7b]/[0.08] p-3 text-xs text-[#f28b7b]">
                    {settlementFlowError}
                  </div>
                )}

                {/* Wallet Action Button */}
                {isConnected ? (
                  activePersonaId !== 'reown-connected' ? (
                    <div className="space-y-2">
                      <div className="rounded-xl border border-[#e8c06a]/40 bg-[#e8c06a]/[0.08] p-3 text-xs text-[#e8c06a] leading-relaxed">
                        Currently simulating a demo wallet. Switch to your connected wallet ({connectedWallet?.slice(0, 6)}…{connectedWallet?.slice(-4)}) to broadcast real funds.
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (connectedWallet) {
                            selectPersona('reown-connected', connectedWallet);
                          }
                        }}
                        className="w-full py-3.5 text-sm rounded-xl font-semibold cursor-pointer border-0 bg-[#efe6d2] text-[#14212a] hover:opacity-95 transition-opacity shadow-md"
                      >
                        Switch to connected wallet ({connectedWallet?.slice(0, 6)}…{connectedWallet?.slice(-4)})
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isExceedingSafetyCap}
                      onClick={() => {
                        if (activeQuote?.source === 'CCTP_V2_TESTNET' && activeQuote.cctp) {
                          void startBurnTransfer(activeQuote.cctp);
                        } else {
                          void approveIfNeededAndSend();
                        }
                      }}
                      className="w-full py-4 text-base rounded-xl font-semibold cursor-pointer border-0 bg-[#efe6d2] text-[#14212a] hover:opacity-95 transition-opacity disabled:bg-[#1c2f3b] disabled:text-[#8ea5b4] disabled:cursor-not-allowed shadow-md"
                    >
                      {requiresApproval
                        ? 'Approve & Send in wallet'
                        : 'Sign and send in wallet'}
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => openAppKit()}
                    className="w-full py-4 text-base rounded-xl font-semibold cursor-pointer border-0 bg-[#efe6d2] text-[#14212a] hover:opacity-95 shadow-md"
                  >
                    Connect wallet to send
                  </button>
                )}

                {/* Simulation Button */}
                <button
                  type="button"
                  onClick={handleRunSimulation}
                  className="w-full py-3 text-sm rounded-xl font-medium cursor-pointer border-0 bg-[#1c2f3b] text-[#eaf0f3] hover:bg-[#27404f] transition-colors"
                >
                  Run simulation (no funds move)
                </button>
              </div>
            )}

            {/* Bitcoin / Monero Modes Content */}
            {(isBtcMode || isXmrMode) && (
              <div className="space-y-3 text-center">
                {!spAddress && isBtcMode ? (
                  <div className="rounded-xl border border-[#e8c06a]/40 bg-[#e8c06a]/[0.08] p-4 text-xs text-[#e8c06a]">
                    No Bitcoin Silent Payment address configured for this link.
                  </div>
                ) : !xmrSubaddress && isXmrMode ? (
                  <div className="rounded-xl border border-[#e8c06a]/40 bg-[#e8c06a]/[0.08] p-4 text-xs text-[#e8c06a]">
                    No Monero subaddress configured for this link.
                  </div>
                ) : !isRateAvailable ? (
                  <div className="rounded-xl border border-[#27404f] bg-[#0f1a21] p-4 text-xs text-[#8ea5b4]">
                    Fetching live exchange rates from /api/rates…
                  </div>
                ) : (
                  <>
                    {/* QR Code Container */}
                    <div className="w-44 h-44 mx-auto rounded-xl border-4 border-[#efe6d2] overflow-hidden bg-[#efe6d2] p-1.5 flex items-center justify-center my-2">
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt="Cake Wallet QR Code"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="text-xs text-[#14212a]">Generating QR…</div>
                      )}
                    </div>

                    <div className="text-xs text-[#8ea5b4]">
                      Scan with Cake Wallet ·{' '}
                      <span className="text-[#eaf0f3] font-medium">
                        {isBtcMode ? `${amountBtc} BTC` : `${amountXmr} XMR`}
                      </span>{' '}
                      (~${linkConfig.amount}, estimated rate)
                    </div>

                    {/* BTC Format Toggle */}
                    {isBtcMode && (
                      <div className="flex gap-2 justify-center">
                        <button
                          type="button"
                          onClick={() => setBtcLegacyFormat(false)}
                          className={`border rounded-full py-1 px-3 text-xs cursor-pointer transition-colors ${
                            !btcLegacyFormat
                              ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
                              : 'border-[#27404f] text-[#8ea5b4]'
                          }`}
                        >
                          BIP-321
                        </button>
                        <button
                          type="button"
                          onClick={() => setBtcLegacyFormat(true)}
                          className={`border rounded-full py-1 px-3 text-xs cursor-pointer transition-colors ${
                            btcLegacyFormat
                              ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
                              : 'border-[#27404f] text-[#8ea5b4]'
                          }`}
                        >
                          Legacy bitcoin:
                        </button>
                      </div>
                    )}

                    {/* URI text in monospace */}
                    <p className="font-mono text-xs text-[#8ea5b4] break-all bg-[#0f1a21] border border-[#27404f] rounded-xl p-2.5 text-left">
                      {activeUri}
                    </p>

                    {/* URI Action Buttons */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(activeUri);
                          showToast('URI copied');
                        }}
                        className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-[#1c2f3b] text-[#eaf0f3] hover:bg-[#27404f] cursor-pointer"
                      >
                        Copy URI
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = activeUri;
                          showToast('Opening Cake Wallet…');
                        }}
                        className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-[#1c2f3b] text-[#eaf0f3] hover:bg-[#27404f] cursor-pointer"
                      >
                        Launch Cake Wallet
                      </button>
                    </div>

                    {/* Claim Button */}
                    <button
                      type="button"
                      onClick={handleUnverifiedClaim}
                      className="w-full py-3.5 text-sm rounded-xl font-semibold bg-[#efe6d2] text-[#14212a] hover:opacity-95 cursor-pointer shadow-md mt-2"
                    >
                      I’ve paid: record receipt
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed left-1/2 bottom-6 -translate-x-1/2 bg-[#efe6d2] text-[#14212a] py-2 px-4 rounded-full font-semibold z-50 text-sm shadow-xl">
            {toastMessage}
          </div>
        )}
      </div>
    </div>
  );
}
