'use client';

import React, { useEffect, useState } from 'react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { OUTBOUND_POISON_TEST_PRESETS } from '@/lib/graph/seed-topologies';
import { toEip55Address } from '@/lib/validators/address';
import type { VaultSettlementMode } from '@/types/veilpay';

export function SafeSend() {
  const {
    outboundCandidateInput,
    outboundExpectedMode,
    outboundScanResult,
    isScanningOutbound,
    judgeMode,
    setOutboundCandidateInput,
    setOutboundExpectedMode,
    runOutboundPoisonScan,
    swapToVerifiedContactAddress,
  } = useVeilPayStore();

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  useEffect(() => {
    if (!outboundScanResult) {
      void runOutboundPoisonScan();
    }
  }, [outboundScanResult, runOutboundPoisonScan]);

  const verdict = outboundScanResult?.verdict;

  return (
    <section aria-label="Safe Send Outbound Guard" className="space-y-4">
      <div>
        <h1 className="font-serif text-[30px] leading-tight text-[#eaf0f3] mb-1 font-normal">
          Safe send
        </h1>
        <p className="text-sm text-[#8ea5b4]">
          Check a recipient before you send. Catches lookalike addresses, address poisoning and wrong-network pastes.
        </p>
      </div>

      {/* Preset Chips (Judge Mode Only) */}
      {judgeMode && (
        <div className="space-y-1.5">
          <div className="text-xs text-[#8ea5b4]">Judge view presets:</div>
          <div className="flex gap-2 flex-wrap">
            {OUTBOUND_POISON_TEST_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setOutboundCandidateInput(preset.address);
                  void runOutboundPoisonScan(preset.address, 'EVM_SOCKET');
                }}
                className="border border-[#27404f] rounded-full py-1 px-3 text-xs text-[#8ea5b4] hover:text-[#eaf0f3] hover:border-[#efe6d2] cursor-pointer transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Expected Network Dropdown */}
      <select
        value={outboundExpectedMode}
        onChange={(e) => {
          const mode = e.target.value as VaultSettlementMode;
          setOutboundExpectedMode(mode);
          void runOutboundPoisonScan(undefined, mode);
        }}
        className="w-full bg-[#0f1a21] border border-[#27404f] rounded-xl px-3.5 py-2.5 text-sm text-[#eaf0f3] outline-none focus:border-[#efe6d2] transition-colors"
      >
        <option value="EVM_SOCKET">Expect EVM (0x…)</option>
        <option value="BTC_SILENT_PAYMENT">Expect Bitcoin (sp1…)</option>
        <option value="XMR_SUBADDRESS">Expect Monero (888…)</option>
      </select>

      {/* Address Input & Check Button */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          value={outboundCandidateInput}
          onChange={(e) => setOutboundCandidateInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runOutboundPoisonScan();
          }}
          placeholder="Paste recipient address"
          className="flex-1 min-w-[220px] bg-[#0f1a21] border border-[#27404f] rounded-xl px-3.5 py-2.5 text-sm font-mono text-[#eaf0f3] outline-none focus:border-[#efe6d2] transition-colors"
        />
        <button
          type="button"
          disabled={isScanningOutbound}
          onClick={() => void runOutboundPoisonScan()}
          className="border-0 rounded-xl px-5 py-2.5 text-sm font-semibold cursor-pointer bg-[#efe6d2] text-[#14212a] hover:opacity-95 transition-opacity disabled:opacity-50"
        >
          {isScanningOutbound ? 'Checking…' : 'Check'}
        </button>
      </div>

      {/* Result Card */}
      {outboundScanResult && (
        <div className="space-y-3 mt-4">
          {/* Result Verdict Banner */}
          {verdict === 'INTERCEPTED_POISONING' && (
            <div className="rounded-2xl p-4 sm:p-[18px] flex gap-3.5 border border-[#f28b7b]/40 bg-[#f28b7b]/[0.09]">
              <div className="flex-none w-8 h-8 rounded-full grid place-items-center font-bold text-[#14212a] bg-[#f28b7b]">
                !
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[16.5px] font-semibold text-[#eaf0f3] mb-0.5">
                  Don’t send: likely address poisoning
                </h3>
                <p className="text-sm text-[#8ea5b4] leading-relaxed">
                  {outboundScanResult.summaryNarrative}
                </p>
              </div>
            </div>
          )}

          {verdict === 'VERIFIED_TRUSTED_CONTACT' && (
            <div className="rounded-2xl p-4 sm:p-[18px] flex gap-3.5 border border-[#7fd6b0]/[0.35] bg-[#7fd6b0]/[0.09]">
              <div className="flex-none w-8 h-8 rounded-full grid place-items-center font-bold text-[#14212a] bg-[#7fd6b0]">
                ✓
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[16.5px] font-semibold text-[#eaf0f3] mb-0.5">
                  Verified trusted contact
                </h3>
                <p className="text-sm text-[#8ea5b4] leading-relaxed">
                  You’ve paid this address{' '}
                  {outboundScanResult.priorLegitimateInteractions} times before.
                  Checksum OK.
                </p>
              </div>
            </div>
          )}

          {verdict === 'VERIFIED_FIRST_TIME_RECIPIENT' && (
            <div className="rounded-2xl p-4 sm:p-[18px] flex gap-3.5 border border-[#7fd6b0]/[0.35] bg-[#7fd6b0]/[0.09]">
              <div className="flex-none w-8 h-8 rounded-full grid place-items-center font-bold text-[#14212a] bg-[#7fd6b0]">
                ✓
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[16.5px] font-semibold text-[#eaf0f3] mb-0.5">
                  First-time recipient, looks fine
                </h3>
                <p className="text-sm text-[#8ea5b4] leading-relaxed">
                  No lookalike match and no dust-spam history. Always double-check
                  the address with the recipient.
                </p>
              </div>
            </div>
          )}

          {verdict === 'INVALID_ADDRESS_OR_NETWORK_MISMATCH' && (
            <div className="rounded-2xl p-4 sm:p-[18px] flex gap-3.5 border border-[#e8c06a]/40 bg-[#e8c06a]/[0.08]">
              <div className="flex-none w-8 h-8 rounded-full grid place-items-center font-bold text-[#14212a] bg-[#e8c06a]">
                !
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[16.5px] font-semibold text-[#eaf0f3] mb-0.5">
                  Wrong network or invalid format
                </h3>
                <p className="text-sm text-[#8ea5b4] leading-relaxed">
                  {outboundScanResult.summaryNarrative}
                </p>
              </div>
            </div>
          )}

          {/* Detailed Character Diff Card for Poisoning Case */}
          {verdict === 'INTERCEPTED_POISONING' && outboundScanResult.matchedTrustedContact && (
            <div className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5 space-y-3">
              <div className="text-xs text-[#8ea5b4]">
                Character match against your contact (green = matched prefix/suffix, red = forged middle)
              </div>

              {/* Character Diff Grid */}
              <div className="flex flex-wrap gap-0.5 font-mono text-xs p-2 bg-[#0f1a21] rounded-xl border border-[#27404f]">
                {outboundScanResult.charDiffGrid.map((cell) => {
                  const isForged = cell.status === 'FORGED_MIDDLE';
                  return (
                    <span
                      key={cell.index}
                      className={`px-1 py-0.5 rounded text-[11px] font-bold ${
                        isForged
                          ? 'bg-[#f28b7b]/20 text-[#f28b7b]'
                          : 'bg-[#7fd6b0]/20 text-[#7fd6b0]'
                      }`}
                    >
                      {cell.candidateChar}
                    </span>
                  );
                })}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
                  Matching start · end
                  <b className="block text-[#eaf0f3] text-[14.5px] font-medium mt-0.5">
                    {outboundScanResult.matchingPrefixChars} ·{' '}
                    {outboundScanResult.matchingSuffixChars} chars
                  </b>
                </div>
                <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
                  Forged middle
                  <b className="block text-[#f28b7b] text-[14.5px] font-medium mt-0.5">
                    {outboundScanResult.forgedMiddleChars} chars
                  </b>
                </div>
                <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
                  Past payments
                  <b className="block text-[#eaf0f3] text-[14.5px] font-medium mt-0.5">
                    {outboundScanResult.priorLegitimateInteractions}
                  </b>
                </div>
                <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
                  Dust victims sent
                  <b className="block text-[#f28b7b] text-[14.5px] font-medium mt-0.5">
                    {outboundScanResult.dustOutDegree.toLocaleString()}
                  </b>
                </div>
              </div>

              {/* Swap Button */}
              <button
                type="button"
                onClick={() => {
                  void swapToVerifiedContactAddress();
                  showToast('Replaced with verified contact address');
                }}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-[#efe6d2] text-[#14212a] hover:opacity-95 cursor-pointer mt-2"
              >
                Use verified contact address ({outboundScanResult.matchedTrustedContact.label})
              </button>
            </div>
          )}

          {/* EIP-55 Checksum Fix Option if applicable */}
          {outboundScanResult.checksumFixSuggestion &&
            outboundCandidateInput.toLowerCase() ===
              outboundScanResult.checksumFixSuggestion.toLowerCase() &&
            outboundCandidateInput !== outboundScanResult.checksumFixSuggestion && (
              <div className="bg-[#0f1a21] border border-[#27404f] rounded-xl p-3 text-xs flex justify-between items-center gap-2">
                <span className="text-[#8ea5b4]">
                  Non-standard capitalization detected.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOutboundCandidateInput(
                      outboundScanResult.checksumFixSuggestion!
                    );
                    void runOutboundPoisonScan(
                      outboundScanResult.checksumFixSuggestion!
                    );
                    showToast('EIP-55 checksum applied');
                  }}
                  className="py-1 px-3 rounded-lg text-xs font-semibold bg-[#1c2f3b] text-[#eaf0f3] hover:bg-[#27404f] cursor-pointer"
                >
                  Apply EIP-55 Checksum
                </button>
              </div>
            )}
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 bg-[#efe6d2] text-[#14212a] py-2 px-4 rounded-full font-semibold z-50 text-sm shadow-xl">
          {toastMessage}
        </div>
      )}
    </section>
  );
}
