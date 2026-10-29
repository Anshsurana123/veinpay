'use client';

import React from 'react';
import { useVeilPayStore } from '@/store/veilpay-store';

export function RouteCard() {
  const {
    activeScan,
    scanError,
    activeQuote,
    isLoadingQuote,
    linkConfig,
    payerTokenSymbol,
    networkEnv,
  } = useVeilPayStore();

  const isTestnet = networkEnv === 'TESTNET';

  const isBlocked =
    activeScan?.verdict === 'INTERCEPTED_TAINT' ||
    activeScan?.verdict === 'INTERCEPTED_SYBIL' ||
    activeScan?.verdict === 'INTERCEPTED_POISONING' ||
    (activeScan?.verdict === 'INCONCLUSIVE' &&
      linkConfig.policy.inconclusivePolicy === 'BLOCK');

  if (isBlocked) {
    return (
      <div id="rt" className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5 mb-3 text-center text-[#8ea5b4] text-sm">
        🔒 Route locked. We don’t build a transaction for blocked wallets.
      </div>
    );
  }

  if (scanError) {
    return (
      <div id="rt" className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5 mb-3 text-center text-[#8ea5b4] text-sm">
        Route unavailable until the wallet check succeeds.
      </div>
    );
  }

  const primaryRoute = activeQuote?.result?.routes?.[0];
  const isEstimate = activeQuote?.source === 'FALLBACK_DETERMINISTIC';
  const isCctp = activeQuote?.source === 'CCTP_V2_TESTNET' || isTestnet;
  const isSameChain = activeQuote?.source === 'SAME_CHAIN_DIRECT';

  let badgeLabel = 'Live quote';
  let badgeClass = 'text-[#7fd6b0] border-[#7fd6b0]/40';

  if (isEstimate) {
    badgeLabel = 'Estimate only';
    badgeClass = 'text-[#e8c06a] border-[#e8c06a]/40';
  } else if (isCctp) {
    badgeLabel = 'Testnet route';
    badgeClass = 'text-[#7fd6b0] border-[#7fd6b0]/40';
  } else if (isSameChain) {
    badgeLabel = 'Same-chain direct';
    badgeClass = 'text-[#7fd6b0] border-[#7fd6b0]/40';
  }

  const bridgeName = isSameChain
    ? 'Direct transfer'
    : isCctp
    ? 'Testnet relay'
    : primaryRoute?.bridgeDisplayName ||
      primaryRoute?.usedBridgeNames?.[0] ||
      'Across';

  const sendAmountFormatted = `$${Number(linkConfig.amount || 250).toLocaleString(
    undefined,
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  )}`;

  const receiverAmountFormatted = primaryRoute?.outputAmountFormatted
    ? primaryRoute.outputAmountFormatted
    : primaryRoute?.toAmount
    ? `${Number(primaryRoute.toAmount).toFixed(2)} ${linkConfig.asset}`
    : `${(Number(linkConfig.amount || 250) * 0.9979).toFixed(2)} ${linkConfig.asset}`;

  const timeFeeFormatted = primaryRoute
    ? `~${primaryRoute.serviceTime || 3} s · $${(primaryRoute.totalGasFeesInUsd || 0.004).toFixed(3)}`
    : '~3 s · $0.004';

  return (
    <div id="rt" className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5 mb-3">
      <div className="flex justify-between items-center mb-2">
        <b className="font-semibold text-[#eaf0f3] text-[15px]">Route</b>
        <span
          className={`text-[11.5px] border rounded-full px-2.5 py-0.5 font-medium ${badgeClass}`}
        >
          {isLoadingQuote ? 'Calculating…' : badgeLabel}
        </span>
      </div>

      {isEstimate && (
        <div className="text-xs text-[#e8c06a] mb-2 leading-relaxed">
          Live routing timed out (3.5 s). Showing an estimate; the final amount may differ.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="bg-[#0f1a21] rounded-xl p-2.5 px-3 text-xs text-[#8ea5b4]">
          Bridge
          <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5 truncate">
            {bridgeName}
          </b>
        </div>
        <div className="bg-[#0f1a21] rounded-xl p-2.5 px-3 text-xs text-[#8ea5b4]">
          You send
          <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
            {sendAmountFormatted}
          </b>
        </div>
        <div className="bg-[#0f1a21] rounded-xl p-2.5 px-3 text-xs text-[#8ea5b4]">
          Receiver gets
          <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
            {receiverAmountFormatted}
          </b>
        </div>
        <div className="bg-[#0f1a21] rounded-xl p-2.5 px-3 text-xs text-[#8ea5b4]">
          Time · fee
          <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
            {timeFeeFormatted}
          </b>
        </div>
      </div>
    </div>
  );
}
