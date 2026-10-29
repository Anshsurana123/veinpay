'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  useAccount,
  useSendTransaction,
  useSwitchChain,
} from 'wagmi';
import {
  X,
  Lock,
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Wallet,
} from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';
import {
  buildBip321SilentPaymentUri,
  buildLegacySilentPaymentUri,
  buildMoneroPaymentUri,
  DEFAULT_CAKE_VAULT_ADDRESSES,
} from '@/lib/validators/address';
import {
  getChainDisplayName,
  getChainExplorerUrl,
  isTestnetChain,
} from '@/lib/socket/tokens';
import { useCctpTransfer } from '@/hooks/useCctpTransfer';
import type { VaultSettlementMode } from '@/types/veilpay';

export function CakeWalletSettlementModal() {
  const {
    settlementModalOpen,
    setSettlementModalOpen,
    linkConfig,
    payerChainId,
    setVaultMode,
    activeScan,
    activeQuote,
    crawlSettings,
    recordSimulatedSettlement,
  } = useVeilPayStore();

  const { address: connectedWallet, isConnected, chainId: walletChainId } =
    useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync, isPending: isBroadcastingTx } =
    useSendTransaction();

  const {
    activeTransfer: cctpTransfer,
    resumableTransfers,
    isBusy: isCctpBusy,
    startBurnTransfer,
    completeMintOnDestination,
  } = useCctpTransfer({
    linkId: linkConfig.handle,
    receiverVaultAddress: linkConfig.vaultAddresses.EVM_SOCKET,
  });

  const [btcLegacyFormat, setBtcLegacyFormat] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedUri, setCopiedUri] = useState(false);
  const [settledConfirmed, setSettledConfirmed] = useState(false);
  const [broadcastedTxHash, setBroadcastedTxHash] = useState<string | null>(
    null
  );
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  const amountNum = Math.max(0.01, Number(linkConfig.amount) || 250);
  const amountBtc = (amountNum / 92000).toFixed(6);
  const amountXmr = (amountNum / 175).toFixed(4);

  const spAddress =
    linkConfig.vaultAddresses.BTC_SILENT_PAYMENT ||
    DEFAULT_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT;
  const xmrSubaddress =
    linkConfig.vaultAddresses.XMR_SUBADDRESS ||
    DEFAULT_CAKE_VAULT_ADDRESSES.XMR_SUBADDRESS;

  const bip321Uri = buildBip321SilentPaymentUri({
    spAddress,
    amountBtc,
    label: `VeilPay:${linkConfig.handle}`,
    message: `VeilPay Verified Clean Settlement ($${linkConfig.amount})`,
  });

  const legacyBtcUri = buildLegacySilentPaymentUri({
    spAddress,
    amountBtc,
    label: `VeilPay:${linkConfig.handle}`,
  });

  const xmrUri = buildMoneroPaymentUri({
    subaddress: xmrSubaddress,
    amountXmr,
    recipientName: `VeilPay:${linkConfig.handle}`,
    description: `VeilPay Verified Clean Settlement ($${linkConfig.amount})`,
  });

  const primaryRoute = activeQuote?.result.routes[0];

  const activeUri =
    linkConfig.settlementMode === 'BTC_SILENT_PAYMENT'
      ? btcLegacyFormat
        ? legacyBtcUri
        : bip321Uri
      : linkConfig.settlementMode === 'XMR_SUBADDRESS'
        ? xmrUri
        : primaryRoute?.txData?.object?.to ??
          linkConfig.vaultAddresses.EVM_SOCKET;

  useEffect(() => {
    if (!settlementModalOpen || !activeScan?.socketUnlocked) return;
    let mounted = true;
    QRCode.toDataURL(activeUri, {
      width: 220,
      margin: 1,
      color: {
        dark: '#F3F1EC',
        light: '#0B0C0E',
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
  }, [settlementModalOpen, activeUri, activeScan?.socketUnlocked]);

  if (!settlementModalOpen || !activeScan) return null;

  const isTestnetFlow =
    isTestnetChain(payerChainId) ||
    isTestnetChain(linkConfig.destinationChainId);
  const isExceedingSafetyCap =
    !isTestnetFlow && Number(linkConfig.amount) > crawlSettings.maxMainnetUsdCap;

  const handleCopyUri = async () => {
    try {
      await navigator.clipboard.writeText(activeUri);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    } catch {
      setCopiedUri(false);
    }
  };

  const handleConfirmSettlement = () => {
    recordSimulatedSettlement(
      broadcastedTxHash ??
        `0x${activeScan.targetWallet.slice(2, 10)}cfe92817a001`
    );
    setSettledConfirmed(true);
    setTimeout(() => {
      setSettledConfirmed(false);
      setBroadcastedTxHash(null);
      setBroadcastError(null);
      setSettlementModalOpen(false);
    }, 1800);
  };

  const handleBroadcastLiveWalletTx = async () => {
    if (!primaryRoute?.txData?.object) return;
    setBroadcastError(null);
    try {
      if (activeQuote?.source === 'CCTP_V2_TESTNET' && activeQuote.cctpRoute) {
        const rec = await startBurnTransfer(activeQuote.cctpRoute);
        if (rec.burnTxHash) {
          setBroadcastedTxHash(rec.burnTxHash);
        }
        if (rec.status === 'FAILED' && rec.failureReason) {
          setBroadcastError(rec.failureReason);
        }
        return;
      }

      if (walletChainId !== payerChainId && switchChainAsync) {
        await switchChainAsync({ chainId: payerChainId });
      }
      const txObj = primaryRoute.txData.object;
      const hash = await sendTransactionAsync({
        to: txObj.to as `0x${string}`,
        data: txObj.data as `0x${string}`,
        value: BigInt(txObj.value || '0'),
        chainId: payerChainId,
      });
      setBroadcastedTxHash(hash);
      recordSimulatedSettlement(hash);
    } catch (err) {
      setBroadcastError(
        err instanceof Error
          ? err.message.slice(0, 140)
          : 'Transaction rejected or failed in wallet.'
      );
    }
  };

  const currentVaultAddr =
    linkConfig.vaultAddresses[linkConfig.settlementMode];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl border border-[#D97736] bg-[#131519] p-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#262A33] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center border border-[#D97736] bg-[#261810] text-[#E5A93C]">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <div className="font-mono text-sm font-bold text-[#F3F1EC]">
                CAKE WALLET ZERO-DOXX VAULT SETTLEMENT
              </div>
              <p className="font-mono text-[11px] text-[#1F9D68]">
                ✓ TIGERGRAPH PRE-SIGN FIREWALL CLEARED ({activeScan.verdict})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSettlementModalOpen(false)}
            className="border border-[#262A33] bg-[#1A1D23] p-1.5 text-[#9499A3] hover:text-[#F3F1EC]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {(
            [
              {
                mode: 'EVM_SOCKET' as VaultSettlementMode,
                label: 'MODE 1: EVM SOCKET V3',
              },
              {
                mode: 'BTC_SILENT_PAYMENT' as VaultSettlementMode,
                label: 'MODE 2: BTC SILENT (BIP-352)',
              },
              {
                mode: 'XMR_SUBADDRESS' as VaultSettlementMode,
                label: 'MODE 3: MONERO (888...)',
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.mode}
              type="button"
              onClick={() => setVaultMode(tab.mode)}
              className={`border py-2 font-mono text-[11px] font-bold transition-colors ${
                linkConfig.settlementMode === tab.mode
                  ? 'border-[#D97736] bg-[#261810] text-[#E5A93C]'
                  : 'border-[#262A33] bg-[#1A1D23] text-[#9499A3] hover:text-[#F3F1EC]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body by Vault Mode */}
        {linkConfig.settlementMode === 'EVM_SOCKET' ? (
          <div className="mt-4 space-y-3">
            <div className="border border-[#262A33] bg-[#0B0C0E] p-3.5 font-mono">
              <div className="mb-2 flex items-center justify-between border-b border-[#262A33] pb-2">
                <span className="text-xs font-bold text-[#E5A93C]">
                  SOCKET SWAP V3 CALLDATA &amp; BRIDGE ROUTE
                </span>
                <span className="border border-[#1F9D68]/50 bg-[#0E291E] px-2 py-0.5 text-[10px] text-[#1F9D68]">
                  {activeQuote?.source ?? 'SOCKET_V3_LIVE'}
                </span>
              </div>

              {primaryRoute ? (
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <div className="text-[10px] text-[#9499A3]">PROTOCOL</div>
                      <div className="font-bold text-[#F3F1EC]">
                        {primaryRoute.bridgeDisplayName}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#9499A3]">
                        NET RECEIVER OUTPUT
                      </div>
                      <div className="font-bold tabular-nums text-[#1F9D68]">
                        {primaryRoute.outputAmountFormatted}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#9499A3]">
                        EXPECTED FINALITY
                      </div>
                      <div className="font-bold tabular-nums text-[#F3F1EC]">
                        {activeQuote?.cctpRoute
                          ? `${activeQuote.cctpRoute.expectedTimeSeconds}s (${activeQuote.cctpRoute.finalityMode})`
                          : `${primaryRoute.serviceTime}s`}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#9499A3]">
                        {activeQuote?.cctpRoute ? 'CCTP BURN FEE' : 'GAS FEE ESTIMATE'}
                      </div>
                      <div className="font-bold tabular-nums text-[#E5A93C]">
                        {activeQuote?.cctpRoute
                          ? `${activeQuote.cctpRoute.feeFormatted} USDC`
                          : `$${primaryRoute.totalGasFeesInUsd.toFixed(4)}`}
                      </div>
                    </div>
                  </div>

                  {activeQuote?.cctpRoute && (
                    <div className="mt-2 border border-[#262A33] bg-[#131519] p-2.5 text-[11px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-[#E5A93C]">
                          CIRCLE CCTP V2 BURN &amp; MINT STATE MACHINE
                        </span>
                        <span className="border border-[#D97736] bg-[#261810] px-1.5 py-0.5 text-[10px] font-bold text-[#E5A93C]">
                          STATUS: {cctpTransfer?.status ?? 'QUOTED'}
                        </span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-1 gap-1 text-[10px] text-[#9499A3] sm:grid-cols-2">
                        <div>
                          GROSS IN: {activeQuote.cctpRoute.amountInFormatted} USDC → NET OUT:{' '}
                          <span className="text-[#1F9D68]">
                            {activeQuote.cctpRoute.netAmountOutFormatted} USDC
                          </span>
                        </div>
                        <div>
                          DOMAINS: {activeQuote.cctpRoute.sourceDomain} →{' '}
                          {activeQuote.cctpRoute.destinationDomain} (minFinality:{' '}
                          {activeQuote.cctpRoute.minFinalityThreshold})
                        </div>
                        <div className="truncate">
                          TokenMessengerV2: {activeQuote.cctpRoute.contracts.tokenMessengerV2}
                        </div>
                        <div className="truncate">
                          MessageTransmitterV2:{' '}
                          {activeQuote.cctpRoute.contracts.messageTransmitterV2}
                        </div>
                      </div>
                      {(cctpTransfer?.status === 'ATTESTED' ||
                        resumableTransfers.some((t) => t.status === 'ATTESTED' || t.status === 'BURN_CONFIRMED')) && (
                        <div className="mt-2 flex items-center justify-between border-t border-[#262A33] pt-2">
                          <span className="text-[10px] text-[#1F9D68]">
                            Iris Attestation Ready — Complete Mint on Destination Chain
                          </span>
                          <button
                            type="button"
                            disabled={isCctpBusy}
                            onClick={() =>
                              void completeMintOnDestination(
                                cctpTransfer ?? resumableTransfers[0]
                              )
                            }
                            className="border border-[#1F9D68] bg-[#1F9D68] px-2.5 py-1 text-[10px] font-bold text-[#0B0C0E] hover:bg-[#25b87b] disabled:opacity-50"
                          >
                            {isCctpBusy ? 'COMPLETING MINT...' : 'COMPLETE TRANSFER (MINT USDC)'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {primaryRoute.txData?.object && (
                    <div className="mt-2 border-t border-[#262A33] pt-2 text-[11px]">
                      <div className="text-[#9499A3]">
                        ROUTER CONTRACT (TO):{' '}
                        <span className="text-[#F3F1EC]">
                          {primaryRoute.txData.object.to}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[#9499A3]">
                        TX CALLDATA:{' '}
                        <span className="text-[#E5A93C]">
                          {primaryRoute.txData.object.data.slice(0, 74)}...
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-[#9499A3]">
                  Direct EVM transfer to Cake Wallet vault:{' '}
                  {linkConfig.vaultAddresses.EVM_SOCKET}
                </div>
              )}
            </div>

            {isTestnetFlow && (
              <div className="flex items-start justify-between gap-2.5 border border-[#1F9D68]/60 bg-[#0E291E]/50 p-3 font-mono text-xs">
                <div>
                  <div className="font-bold text-[#1F9D68]">
                    TESTNET SANDBOX READY ({getChainDisplayName(payerChainId)})
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#F3F1EC]">
                    Mainnet USD safety caps are bypassed on Testnet. Connect a
                    wallet via Reown AppKit to sign &amp; broadcast this
                    transaction on {getChainDisplayName(payerChainId)}, or
                    simulate settlement instantly below.
                  </p>
                </div>
                <a
                  href="https://faucet.circle.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 border border-[#D97736] bg-[#261810] px-2.5 py-1 text-[10px] font-bold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E]"
                >
                  USDC FAUCET ↗
                </a>
              </div>
            )}

            {broadcastedTxHash && (
              <div className="flex items-center justify-between border border-[#1F9D68] bg-[#0E291E] p-3 font-mono text-xs">
                <div className="truncate text-[#1F9D68]">
                  ✓ ON-CHAIN TX BROADCASTED: {broadcastedTxHash.slice(0, 18)}...
                </div>
                <a
                  href={`${getChainExplorerUrl(payerChainId)}/tx/${broadcastedTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 border border-[#1F9D68] bg-[#0B0C0E] px-2.5 py-1 text-[10px] font-bold text-[#1F9D68] hover:bg-[#1F9D68] hover:text-[#0B0C0E]"
                >
                  VIEW ON EXPLORER <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {broadcastError && (
              <div className="border border-[#D6453A] bg-[#2D1412] p-2.5 font-mono text-[11px] text-[#D6453A]">
                WALLET TX ERROR: {broadcastError}
              </div>
            )}

            {isExceedingSafetyCap && (
              <div className="flex items-start gap-2.5 border border-[#D99B26] bg-[#2B210D]/50 p-3 font-mono text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#D99B26]" />
                <div>
                  <div className="font-bold text-[#E5A93C]">
                    MAINNET SAFETY CAP ACTIVE ($
                    {crawlSettings.maxMainnetUsdCap.toFixed(2)} USD CAP)
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#F3F1EC]">
                    Requested amount (${linkConfig.amount} USD) exceeds the
                    configured live mainnet safety cap. Clicking confirm below
                    executes a zero-risk deterministic settlement simulation and
                    appends the signed AIGI receipt to the receiver feed.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-5">
            <div className="flex flex-col items-center justify-center border border-[#262A33] bg-[#0B0C0E] p-3 sm:col-span-2">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Cake Wallet Deep-Link QR Code"
                  className="h-44 w-44 border border-[#262A33]"
                />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center font-mono text-xs text-[#9499A3]">
                  GENERATING QR...
                </div>
              )}
              <span className="mt-2 font-mono text-[10px] text-[#E5A93C]">
                SCAN WITH CAKE WALLET MOBILE / DESKTOP
              </span>
            </div>

            <div className="flex flex-col justify-between border border-[#262A33] bg-[#0B0C0E] p-3.5 font-mono sm:col-span-3">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#E5A93C]">
                    {linkConfig.settlementMode === 'BTC_SILENT_PAYMENT'
                      ? 'BITCOIN SILENT PAYMENT (BIP-352 / BIP-321)'
                      : 'MONERO SUBADDRESS (888... RINGCT)'}
                  </span>
                  {linkConfig.settlementMode === 'BTC_SILENT_PAYMENT' && (
                    <button
                      type="button"
                      onClick={() => setBtcLegacyFormat(!btcLegacyFormat)}
                      className="border border-[#D97736] bg-[#261810] px-2 py-0.5 text-[10px] text-[#E5A93C]"
                    >
                      {btcLegacyFormat
                        ? 'USING LEGACY bitcoin:sp1...'
                        : 'USING BIP-321 bitcoin:?sp=sp1...'}
                    </button>
                  )}
                </div>

                <div className="text-xs text-[#9499A3]">
                  AMOUNT:{' '}
                  <span className="font-bold text-[#1F9D68]">
                    {linkConfig.settlementMode === 'BTC_SILENT_PAYMENT'
                      ? `${amountBtc} BTC`
                      : `${amountXmr} XMR`}{' '}
                    (${linkConfig.amount} USD)
                  </span>
                </div>

                <div>
                  <div className="mb-1 text-[10px] text-[#9499A3]">
                    SPEC-COMPLIANT DEEP-LINK URI:
                  </div>
                  <div className="max-h-24 overflow-y-auto break-all border border-[#262A33] bg-[#131519] p-2 text-[10px] text-[#F3F1EC]">
                    {activeUri}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleCopyUri}
                  className="flex flex-1 items-center justify-center gap-1.5 border border-[#262A33] bg-[#1A1D23] py-2 text-xs font-semibold text-[#F3F1EC] hover:border-[#D97736]"
                >
                  {copiedUri ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#1F9D68]" />
                      COPIED URI
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-[#E5A93C]" />
                      COPY URI
                    </>
                  )}
                </button>
                <a
                  href={activeUri}
                  className="flex flex-1 items-center justify-center gap-1.5 border border-[#D97736] bg-[#261810] py-2 text-xs font-semibold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  LAUNCH CAKE WALLET
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Footer Confirm Action */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#262A33] pt-3">
          <span className="font-mono text-[11px] text-[#9499A3]">
            DESTINATION: {currentVaultAddr.slice(0, 14)}...
            {currentVaultAddr.slice(-6)}
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {linkConfig.settlementMode === 'EVM_SOCKET' &&
              isConnected &&
              connectedWallet &&
              primaryRoute?.txData?.object &&
              !isExceedingSafetyCap && (
                <button
                  type="button"
                  disabled={isBroadcastingTx}
                  onClick={handleBroadcastLiveWalletTx}
                  className="flex items-center gap-1.5 border border-[#D97736] bg-[#261810] px-3.5 py-2.5 font-mono text-xs font-bold text-[#E5A93C] transition-colors hover:bg-[#D97736] hover:text-[#0B0C0E] disabled:opacity-50"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  {isBroadcastingTx
                    ? 'SIGNING IN WALLET...'
                    : `SIGN & BROADCAST ON ${getChainDisplayName(payerChainId).toUpperCase()}`}
                </button>
              )}

            <button
              type="button"
              onClick={handleConfirmSettlement}
              className="flex items-center gap-2 border border-[#1F9D68] bg-[#1F9D68] px-4 py-2.5 font-mono text-xs font-bold text-[#0B0C0E] transition-colors hover:bg-[#25b87b]"
            >
              {settledConfirmed ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  SETTLEMENT LOGGED TO RECEIVER FEED!
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  EXECUTE SETTLEMENT &amp; RECORD COMPLIANCE RECEIPT
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
