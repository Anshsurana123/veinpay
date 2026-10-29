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
  } = useVeilPayStore();

  const isBlocked =
    activeScan?.verdict === 'INTERCEPTED_TAINT' ||
    activeScan?.verdict === 'INTERCEPTED_SYBIL' ||
    activeScan?.verdict === 'INTERCEPTED_POISONING' ||
    (activeScan?.verdict === 'INCONCLUSIVE' &&
      linkConfig.policy.inconclusivePolicy === 'BLOCK');

  if (isBlocked) {
    return (
      <div className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5 mb-3 text-center text-[#8ea5b4] text-sm">
        🔒 Route locked. We don’t build a transaction for blocked wallets.
      </div>
    );
  }

  if (scanError) {
    return (
      <div className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5 mb-3 text-center text-[#8ea5b4] text-sm">
        Route unavailable until the wallet check succeeds.
      </div>
    );
  }

  if (isLoadingQuote) {
    return (
      <div className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5 mb-3">
        <div className="flex justify-between items-center mb-3">
          <b className="font-semibold text-[#eaf0f3]">Route</b>
          <span className="text-[11.5px] border border-[#27404f] rounded-full px-2.5 py-0.5 text-[#8ea5b4]">
            Fetching quote…
          </span>
        </div>
        <div className="text-sm text-[#8ea5b4]">
          Querying optimal cross-chain bridge and gas route…
        </div>
      </div>
    );
  }

  if (!activeQuote || !activeQuote.result?.routes || activeQuote.result.routes.length === 0) {
    return (
      <div className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5 mb-3 text-sm text-[#8ea5b4]">
        Select your source chain and token to calculate the optimal settlement route.
      </div>
    );
  }

  const primaryRoute = activeQuote.result.routes[0];
  const isEstimate = activeQuote.source === 'FALLBACK_DETERMINISTIC';
  const isCctp = activeQuote.source === 'CCTP_V2_TESTNET';
  const isSameChain = activeQuote.source === 'SAME_CHAIN_DIRECT';

  let badgeLabel = 'Live quote';
  let badgeColor = 'text-[#7fd6b0] border-[#7fd6b0]/40';

  if (isEstimate) {
    badgeLabel = 'Estimate only';
    badgeColor = 'text-[#e8c06a] border-[#e8c06a]/40';
  } else if (isCctp) {
    badgeLabel = 'CCTP V2 Testnet';
    badgeColor = 'text-[#e8c06a] border-[#e8c06a]/40';
  } else if (isSameChain) {
    badgeLabel = 'Same-chain direct';
    badgeColor = 'text-[#7fd6b0] border-[#7fd6b0]/40';
  }

  const bridgeName = isSameChain
    ? 'Direct transfer'
    : isCctp
    ? 'Circle CCTP V2'
    : primaryRoute.bridgeDisplayName || primaryRoute.usedBridgeNames?.[0] || 'Socket V3';

  const toAmountFormatted = primaryRoute.outputAmountFormatted
    ? Number(primaryRoute.outputAmountFormatted).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })
    : primaryRoute.toAmount
    ? Number(primaryRoute.toAmount).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })
    : `${linkConfig.amount}`;

  const timeFormatted = primaryRoute.serviceTime
    ? `~${primaryRoute.serviceTime} s`
    : '< 5 s';

  const feeFormatted =
    primaryRoute.totalGasFeesInUsd !== undefined
      ? `$${primaryRoute.totalGasFeesInUsd.toFixed(3)}`
      : '< $0.01';

  return (
    <div className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5 mb-3">
      <div className="flex justify-between items-center mb-2">
        <b className="font-semibold text-[#eaf0f3]">Route</b>
        <span
          className={`text-[11.5px] border rounded-full px-2.5 py-0.5 font-medium ${badgeColor}`}
        >
          {badgeLabel}
        </span>
      </div>

      {isEstimate && (
        <div className="text-xs text-[#e8c06a] mb-2 leading-relaxed">
          Live routing timed out or unreachable. Showing a deterministic estimate; the final amount may differ slightly.
        </div>
      )}

      {isCctp && (
        <div className="text-xs text-[#8ea5b4] mb-2">
          Source domain {activeQuote.cctp?.sourceDomain ?? '0'} → Destination domain {activeQuote.cctp?.destinationDomain ?? '6'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
          Bridge
          <b className="block text-[#eaf0f3] text-[14.5px] font-medium mt-0.5 truncate">
            {bridgeName}
          </b>
        </div>
        <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
          You send
          <b className="block text-[#eaf0f3] text-[14.5px] font-medium mt-0.5">
            ${Number(linkConfig.amount).toLocaleString(undefined, {
              minimumFractionDigits: 2,
            })}{' '}
            <span className="text-xs text-[#8ea5b4] font-normal">
              {payerTokenSymbol}
            </span>
          </b>
        </div>
        <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
          Receiver gets
          <b className="block text-[#eaf0f3] text-[14.5px] font-medium mt-0.5">
            {toAmountFormatted}{' '}
            <span className="text-xs text-[#8ea5b4] font-normal">
              {linkConfig.asset}
            </span>
          </b>
        </div>
        <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
          Time · fee
          <b className="block text-[#eaf0f3] text-[14.5px] font-medium mt-0.5">
            {timeFormatted} · {feeFormatted}
          </b>
        </div>
      </div>
    </div>
  );
}
