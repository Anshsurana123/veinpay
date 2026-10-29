'use client';

import React, { useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  AlertTriangle,
  ArrowRightLeft,
} from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { OUTBOUND_POISON_TEST_PRESETS } from '@/lib/graph/seed-topologies';
import type { VaultSettlementMode } from '@/types/veilpay';

export function SafeSendOutboundGuard() {
  const {
    outboundCandidateInput,
    outboundExpectedMode,
    outboundScanResult,
    isScanningOutbound,
    setOutboundCandidateInput,
    setOutboundExpectedMode,
    runOutboundPoisonScan,
    swapToVerifiedContactAddress,
  } = useVeilPayStore();

  const initialOutboundScanAttemptedRef = React.useRef(false);
  useEffect(() => {
    if (!outboundScanResult && !isScanningOutbound && !initialOutboundScanAttemptedRef.current) {
      initialOutboundScanAttemptedRef.current = true;
      void runOutboundPoisonScan();
    }
  }, [outboundScanResult, isScanningOutbound, runOutboundPoisonScan]);

  const verdict = outboundScanResult?.verdict;

  return (
    <div className="space-y-4">
      <div className="border border-[#262A33] bg-[#131519] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#262A33] pb-2.5">
          <div>
            <span className="font-mono text-xs font-semibold tracking-wider text-[#D97736] uppercase">
              MODULE E // SAFE SEND OUTBOUND POISONGRAPH GUARD
            </span>
            <p className="mt-0.5 text-xs text-[#9499A3]">
              Pre-send character-diff lookalike detector &amp; zero-value
              dust-factory out-degree analyzer.
            </p>
          </div>
          <span className="border border-[#262A33] bg-[#1A1D23] px-2 py-0.5 font-mono text-[10px] text-[#E5A93C]">
            CASE 4A / 4B / 4C DEFENSE
          </span>
        </div>

        {/* 1-Click Scenario Triggers */}
        <div className="mb-3">
          <div className="mb-1.5 font-mono text-[10px] font-medium text-[#9499A3] uppercase">
            1-CLICK EDGE-CASE SIMULATOR PRESETS:
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {OUTBOUND_POISON_TEST_PRESETS.map((preset) => {
              const isDanger = preset.id === 'poison-clone';
              const isSafe = preset.id === 'trusted-contact';
              const isMismatch = preset.id === 'wrong-network-sp1';
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    void runOutboundPoisonScan(preset.address, 'EVM_SOCKET')
                  }
                  className={`flex items-center justify-between border px-2.5 py-2 text-left font-mono text-[11px] text-[#F3F1EC] transition-colors ${
                    isDanger
                      ? 'border-[#D6453A]/50 bg-[#2D1412]/60 hover:border-[#D6453A]'
                      : isSafe
                        ? 'border-[#1F9D68]/50 bg-[#0E291E]/60 hover:border-[#1F9D68]'
                        : isMismatch
                          ? 'border-[#D99B26]/50 bg-[#2B210D]/60 hover:border-[#D99B26]'
                          : 'border-[#262A33] bg-[#1A1D23] hover:border-[#363B47]'
                  }`}
                >
                  <span className="truncate pr-2">{preset.label}</span>
                  <span
                    className={`shrink-0 text-[9px] ${
                      isDanger
                        ? 'text-[#D6453A]'
                        : isSafe
                          ? 'text-[#1F9D68]'
                          : isMismatch
                            ? 'text-[#D99B26]'
                            : 'text-[#9499A3]'
                    }`}
                  >
                    {preset.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Address Input & Expected Mode */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={outboundExpectedMode}
            onChange={(e) =>
              setOutboundExpectedMode(e.target.value as VaultSettlementMode)
            }
            className="border border-[#262A33] bg-[#1A1D23] px-2.5 py-2 font-mono text-xs text-[#F3F1EC] focus:border-[#D97736] focus:outline-none"
          >
            <option value="EVM_SOCKET">Expected: EVM (0x...)</option>
            <option value="BTC_SILENT_PAYMENT">Expected: BTC (sp1...)</option>
            <option value="XMR_SUBADDRESS">Expected: Monero (888...)</option>
          </select>

          <div className="flex flex-1 items-center border border-[#262A33] bg-[#0B0C0E] px-2.5 py-2 focus-within:border-[#D97736]">
            <input
              type="text"
              value={outboundCandidateInput}
              onChange={(e) => setOutboundCandidateInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runOutboundPoisonScan();
              }}
              placeholder="Paste recipient address (0x..., sp1..., 888...)"
              className="w-full bg-transparent font-mono text-xs text-[#F3F1EC] focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => void runOutboundPoisonScan()}
            disabled={isScanningOutbound}
            className="flex items-center justify-center gap-1.5 border border-[#D97736] bg-[#D97736] px-4 py-2 font-mono text-xs font-bold text-[#0B0C0E] transition-colors hover:bg-[#E5A93C] disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
            {isScanningOutbound ? 'SCANNING...' : 'INSPECT'}
          </button>
        </div>
      </div>

      {outboundScanResult && (
        <div
          className={`border p-4 ${
            verdict === 'INTERCEPTED_POISONING'
              ? 'border-[#D6453A] bg-[#2D1412]/40'
              : verdict === 'INVALID_ADDRESS_OR_NETWORK_MISMATCH'
                ? 'border-[#D99B26] bg-[#2B210D]/40'
                : 'border-[#1F9D68] bg-[#0E291E]/40'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#262A33] pb-3">
            <div className="flex items-center gap-2.5">
              {verdict === 'INTERCEPTED_POISONING' ? (
                <ShieldAlert className="h-5 w-5 text-[#D6453A]" />
              ) : verdict === 'INVALID_ADDRESS_OR_NETWORK_MISMATCH' ? (
                <AlertTriangle className="h-5 w-5 text-[#D99B26]" />
              ) : (
                <ShieldCheck className="h-5 w-5 text-[#1F9D68]" />
              )}
              <div>
                <div className="font-mono text-xs font-bold tracking-wider uppercase text-[#F3F1EC]">
                  {verdict === 'INTERCEPTED_POISONING' &&
                    'CRITICAL INTERCEPT // VANITY ADDRESS POISONING & DUST FACTORY'}
                  {verdict === 'VERIFIED_TRUSTED_CONTACT' &&
                    'VERIFIED // HISTORICAL TRUSTED CONTACT MATCH'}
                  {verdict === 'VERIFIED_FIRST_TIME_RECIPIENT' &&
                    'SAFE // FIRST-TIME RECIPIENT (0 DUST-FACTORY ACTIVITY)'}
                  {verdict === 'INVALID_ADDRESS_OR_NETWORK_MISMATCH' &&
                    'BLOCKED // MULTI-CHAIN FORMAT OR EIP-55 CHECKSUM MISMATCH'}
                </div>
                <p className="mt-0.5 text-xs text-[#9499A3]">
                  {outboundScanResult.summaryNarrative}
                </p>
              </div>
            </div>

            <span className="border border-[#262A33] bg-[#0B0C0E] px-2 py-0.5 font-mono text-[10px] tabular-nums text-[#9499A3]">
              {outboundScanResult.executionTimeMs.toFixed(2)} ms
            </span>
          </div>

          {outboundScanResult.charDiffGrid.length > 0 &&
            outboundScanResult.matchedTrustedContact && (
              <div className="mt-4 border border-[#262A33] bg-[#0B0C0E] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-semibold text-[#E5A93C] uppercase">
                    42-CHARACTER VISUAL BYTE DIFF (CANDIDATE vs. TRUSTED CONTACT)
                  </span>
                  <div className="flex items-center gap-3 font-mono text-[10px]">
                    <span className="flex items-center gap-1 text-[#D99B26]">
                      <span className="inline-block h-2 w-2 bg-[#D99B26]" />
                      MATCHED PREFIX/SUFFIX (
                      {outboundScanResult.matchingPrefixChars} +{' '}
                      {outboundScanResult.matchingSuffixChars} chars)
                    </span>
                    <span className="flex items-center gap-1 text-[#D6453A]">
                      <span className="inline-block h-2 w-2 bg-[#D6453A]" />
                      FORGED MIDDLE ({outboundScanResult.forgedMiddleChars}{' '}
                      chars)
                    </span>
                  </div>
                </div>

                <div className="mb-2">
                  <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-[#9499A3]">
                    <span>PASTED CANDIDATE ADDRESS:</span>
                    <span className="text-[#D6453A]">
                      {outboundScanResult.priorLegitimateInteractions} PRIOR
                      LEGITIMATE TRANSFERS
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-0.5 font-mono text-xs">
                    {outboundScanResult.charDiffGrid.map((cell) => {
                      const isForged = cell.status === 'FORGED_MIDDLE';
                      const isMimic =
                        cell.status === 'MATCH_PREFIX_SUFFIX' &&
                        verdict === 'INTERCEPTED_POISONING';
                      return (
                        <span
                          key={`cand-${cell.index}`}
                          className={`inline-flex h-6 w-4 items-center justify-center border text-[11px] font-bold tabular-nums ${
                            isForged
                              ? 'border-[#D6453A] bg-[#2D1412] text-[#D6453A]'
                              : isMimic
                                ? 'border-[#D99B26] bg-[#2B210D] text-[#D99B26]'
                                : 'border-[#1F9D68]/50 bg-[#0E291E] text-[#1F9D68]'
                          }`}
                          title={`Byte #${cell.index}: Candidate '${cell.candidateChar}' vs Trusted '${cell.trustedChar}' (${cell.zone})`}
                        >
                          {cell.candidateChar}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-[#9499A3]">
                    <span>
                      TRUSTED CONTACT (
                      {outboundScanResult.matchedTrustedContact.label}):
                    </span>
                    <span className="text-[#1F9D68]">
                      {
                        outboundScanResult.matchedTrustedContact
                          .priorOutboundCount
                      }{' '}
                      VERIFIED PRIOR TRANSFERS ($
                      {outboundScanResult.matchedTrustedContact.totalVolumeUsd.toLocaleString()}
                      )
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-0.5 font-mono text-xs">
                    {outboundScanResult.charDiffGrid.map((cell) => (
                      <span
                        key={`trust-${cell.index}`}
                        className={`inline-flex h-6 w-4 items-center justify-center border text-[11px] tabular-nums ${
                          cell.zone === 'PREFIX' || cell.zone === 'SUFFIX'
                            ? 'border-[#D99B26]/60 bg-[#2B210D]/50 font-bold text-[#E5A93C]'
                            : 'border-[#262A33] bg-[#131519] text-[#9499A3]'
                        }`}
                      >
                        {cell.trustedChar}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
              <div className="font-mono text-[10px] text-[#9499A3]">
                PRIOR LEGITIMATE TXS
              </div>
              <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#F3F1EC]">
                {outboundScanResult.priorLegitimateInteractions}
              </div>
            </div>
            <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
              <div className="font-mono text-[10px] text-[#9499A3]">
                DUST-FACTORY OUT-DEGREE
              </div>
              <div
                className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                  outboundScanResult.dustOutDegree > 0
                    ? 'text-[#D6453A]'
                    : 'text-[#1F9D68]'
                }`}
              >
                {outboundScanResult.dustOutDegree.toLocaleString()} victims
              </div>
            </div>
            <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
              <div className="font-mono text-[10px] text-[#9499A3]">
                PREFIX / SUFFIX MATCH
              </div>
              <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#E5A93C]">
                {outboundScanResult.matchingPrefixChars} /{' '}
                {outboundScanResult.matchingSuffixChars} chars
              </div>
            </div>
            <div className="border border-[#262A33] bg-[#0B0C0E] p-2.5">
              <div className="font-mono text-[10px] text-[#9499A3]">
                FORGED MIDDLE BYTES
              </div>
              <div
                className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                  outboundScanResult.forgedMiddleChars > 0
                    ? 'text-[#D6453A]'
                    : 'text-[#1F9D68]'
                }`}
              >
                {outboundScanResult.forgedMiddleChars} chars
              </div>
            </div>
          </div>

          {verdict === 'INTERCEPTED_POISONING' &&
            outboundScanResult.matchedTrustedContact && (
              <div className="mt-3 flex flex-col items-stretch justify-between gap-2 border border-[#1F9D68] bg-[#0E291E] p-3 sm:flex-row sm:items-center">
                <div>
                  <div className="font-mono text-xs font-bold text-[#1F9D68]">
                    ONE-CLICK REMEDIATION AVAILABLE
                  </div>
                  <p className="font-mono text-[11px] text-[#F3F1EC]">
                    Replace poisoned vanity clone with verified contact{' '}
                    <span className="text-[#E5A93C]">
                      {outboundScanResult.matchedTrustedContact.label} (
                      {outboundScanResult.matchedTrustedContact.address.slice(
                        0,
                        10
                      )}
                      ...
                      {outboundScanResult.matchedTrustedContact.address.slice(
                        -4
                      )}
                      )
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void swapToVerifiedContactAddress()}
                  className="flex items-center justify-center gap-1.5 border border-[#1F9D68] bg-[#1F9D68] px-3.5 py-2 font-mono text-xs font-bold text-[#0B0C0E] transition-colors hover:bg-[#25b87b]"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  SWAP TO VERIFIED CONTACT ADDRESS
                </button>
              </div>
            )}

          {verdict === 'INVALID_ADDRESS_OR_NETWORK_MISMATCH' &&
            outboundScanResult.checksumFixSuggestion && (
              <div className="mt-3 flex items-center justify-between border border-[#D99B26] bg-[#2B210D] p-3">
                <div className="font-mono text-xs text-[#F3F1EC]">
                  Valid EIP-55 Checksummed Equivalent:{' '}
                  <span className="text-[#E5A93C]">
                    {outboundScanResult.checksumFixSuggestion}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void runOutboundPoisonScan(
                      outboundScanResult.checksumFixSuggestion
                    )
                  }
                  className="border border-[#E5A93C] bg-[#D97736] px-3 py-1 font-mono text-xs font-bold text-[#0B0C0E]"
                >
                  APPLY EIP-55 FIX
                </button>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
