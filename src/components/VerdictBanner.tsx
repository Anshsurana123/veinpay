'use client';

import React from 'react';
import { useVeinPayStore } from '@/store/veinpay-store';

export function VerdictBanner() {
  const {
    activeScan,
    scanError,
    runFirewallAndQuotePipeline,
    isScanning,
    linkConfig,
  } = useVeinPayStore();

  if (isScanning) {
    return null;
  }

  if (scanError) {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="rounded-2xl p-4 sm:p-[18px] flex gap-3.5 mb-3 border border-[#f28b7b]/40 bg-[#f28b7b]/10"
      >
        <div className="flex-none w-8 h-8 rounded-full grid place-items-center font-bold text-[#14212a] bg-[#f28b7b]">
          !
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[16.5px] font-semibold text-[#eaf0f3] mb-1">
            We couldn’t check this wallet
          </h3>
          <p className="text-sm text-[#8ea5b4] mb-3">
            {scanError}. The history service didn’t respond in time. Nothing was sent.
            Retry the scan, or try again in a minute.
          </p>
          <button
            type="button"
            onClick={() => void runFirewallAndQuotePipeline()}
            className="border-0 rounded-xl py-2 px-4 text-sm font-semibold cursor-pointer bg-[#1c2f3b] text-[#eaf0f3] hover:bg-[#27404f] transition-colors"
          >
            Retry scan
          </button>
        </div>
      </div>
    );
  }

  if (!activeScan) {
    return null;
  }

  const {
    verdict,
    maxHopsQueried,
    taintHits,
    minTaintHop,
    sybilClusterSize,
    dustOutDegree,
    inconclusiveReason,
  } = activeScan;

  let styleType: 'ok' | 'bad' | 'wn' = 'ok';
  let badgeChar = '✓';
  let title = '';
  let description = '';

  switch (verdict) {
    case 'VERIFIED_CLEAN':
      styleType = 'ok';
      badgeChar = '✓';
      title = 'Your wallet is clear to pay';
      description = `Traced funds ${maxHopsQueried} step${
        maxHopsQueried === 1 ? '' : 's'
      } back. No mixers, drainers or sybil rings found.`;
      break;

    case 'INTERCEPTED_TAINT':
      styleType = 'bad';
      badgeChar = '!';
      title = 'This payment is blocked';
      description = `Your funds came from a known drainer or sanctioned cluster ${
        minTaintHop ?? 1
      } step${(minTaintHop ?? 1) === 1 ? '' : 's'} back (${taintHits} threat hit${
        taintHits === 1 ? '' : 's'
      }). The receiver’s firewall doesn’t accept it. Try a different wallet.`;
      break;

    case 'INTERCEPTED_SYBIL':
      styleType = 'bad';
      badgeChar = '!';
      title = 'Blocked: linked wallet group';
      description = `Your wallet is one of ${sybilClusterSize} wallets funded by the same source. This receiver blocks groups of ${
        linkConfig.policy.sybilBlockThreshold ?? 10
      } or more.`;
      break;

    case 'WARNING_SYBIL':
      styleType = 'wn';
      badgeChar = '!';
      title = 'Allowed, with a caution';
      description = `Your wallet is linked to ${sybilClusterSize} related wallets or a circular transfer. The receiver still accepts it.`;
      break;

    case 'INTERCEPTED_POISONING':
      styleType = 'bad';
      badgeChar = '!';
      title = 'Blocked: dust-spam wallet';
      description = `This wallet sent tiny transfers to ${dustOutDegree} lookalike addresses, a sign of address poisoning.`;
      break;

    case 'ADVISORY_BYPASSED':
      styleType = 'wn';
      badgeChar = '!';
      title = 'Firewall is off for this link';
      description =
        'Checks still run and show below, but the receiver chose not to block on them.';
      break;

    case 'INCONCLUSIVE':
      styleType =
        linkConfig.policy.inconclusivePolicy === 'WARN' ? 'wn' : 'bad';
      badgeChar = '?';
      title =
        linkConfig.policy.inconclusivePolicy === 'WARN'
          ? 'Allowed with caution: history incomplete'
          : 'Blocked: history could not be verified';
      description = `Live crawling could not complete verification (${
        inconclusiveReason ?? 'data unavailable or timeout'
      }). ${
        linkConfig.policy.inconclusivePolicy === 'WARN'
          ? 'Receiver policy permits unverified wallets with advisory.'
          : 'Receiver policy requires full pre-flight verification.'
      }`;
      break;

    default:
      styleType = 'wn';
      badgeChar = '?';
      title = 'Review recommended';
      description = 'Unknown verdict status received from the engine.';
      break;
  }

  const bgBorderClass =
    styleType === 'ok'
      ? 'bg-[#7fd6b0]/[0.09] border-[#7fd6b0]/[0.35]'
      : styleType === 'bad'
      ? 'bg-[#f28b7b]/[0.09] border-[#f28b7b]/40'
      : 'bg-[#e8c06a]/[0.08] border-[#e8c06a]/40';

  const badgeBgClass =
    styleType === 'ok'
      ? 'bg-[#7fd6b0]'
      : styleType === 'bad'
      ? 'bg-[#f28b7b]'
      : 'bg-[#e8c06a]';

  return (
    <>
      {/* 1-Hop Advisory Warning */}
      {maxHopsQueried === 1 && verdict === 'VERIFIED_CLEAN' && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[#e8c06a]/40 bg-[#e8c06a]/[0.08] px-3 py-2 text-[13.5px] text-[#e8c06a] mb-3">
          <span>Only 1 step back was checked. Deeper risks may be missed.</span>
        </div>
      )}

      {/* Primary Verdict Banner */}
      <div
        role="alert"
        aria-live="polite"
        className={`rounded-2xl p-4 sm:p-[18px] flex gap-3.5 mb-3 border ${bgBorderClass}`}
      >
        <div
          className={`flex-none w-8 h-8 rounded-full grid place-items-center font-bold text-[#14212a] ${badgeBgClass}`}
        >
          {badgeChar}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[16.5px] font-semibold text-[#eaf0f3] mb-0.5">
            {title}
          </h3>
          <p className="text-sm text-[#8ea5b4] leading-relaxed">{description}</p>
        </div>
      </div>
    </>
  );
}
