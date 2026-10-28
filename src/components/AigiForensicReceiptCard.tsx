'use client';

import React, { useState } from 'react';
import {
  FileCheck2,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Download,
  Copy,
  Check,
  Sparkles,
  Hash,
} from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';

export function AigiForensicReceiptCard() {
  const {
    activeReceipt,
    activeScan,
    isGeneratingAiNarrative,
    requestGeminiExecutiveSummary,
  } = useVeilPayStore();

  const [copiedJson, setCopiedJson] = useState(false);

  if (!activeReceipt || !activeScan) {
    return null;
  }

  const isBlocked =
    activeReceipt.verdict === 'INTERCEPTED_TAINT' ||
    activeReceipt.verdict === 'INTERCEPTED_SYBIL' ||
    activeReceipt.verdict === 'INTERCEPTED_POISONING';
  const isWarning =
    activeReceipt.verdict === 'WARNING_SYBIL' ||
    activeReceipt.verdict === 'ADVISORY_BYPASSED';

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(activeReceipt, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veilpay-aigi-receipt-${activeReceipt.sha256CommitmentHash.slice(0, 12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(activeReceipt, null, 2)
      );
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } catch {
      setCopiedJson(false);
    }
  };

  return (
    <div
      className={`border p-4 ${
        isBlocked
          ? 'border-[#D6453A] bg-[#2D1412]/30'
          : isWarning
            ? 'border-[#D99B26] bg-[#2B210D]/30'
            : 'border-[#1F9D68] bg-[#0E291E]/30'
      }`}
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262A33] pb-3">
        <div className="flex items-center gap-2.5">
          {isBlocked ? (
            <ShieldAlert className="h-5 w-5 text-[#D6453A]" />
          ) : isWarning ? (
            <AlertTriangle className="h-5 w-5 text-[#D99B26]" />
          ) : (
            <ShieldCheck className="h-5 w-5 text-[#1F9D68]" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold tracking-wider uppercase text-[#F3F1EC]">
                MODULE D // AIGI FORENSIC SECURITY VERDICT
              </span>
              <span
                className={`border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                  isBlocked
                    ? 'border-[#D6453A] bg-[#2D1412] text-[#D6453A]'
                    : isWarning
                      ? 'border-[#D99B26] bg-[#2B210D] text-[#D99B26]'
                      : 'border-[#1F9D68] bg-[#0E291E] text-[#1F9D68]'
                }`}
              >
                {activeReceipt.verdict}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-[#9499A3]">
              RECEIPT ID: {activeReceipt.receiptId} · RISK SCORE:{' '}
              <span className="font-bold text-[#F3F1EC] tabular-nums">
                {activeReceipt.riskScore}/100
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopyJson}
            className="flex items-center gap-1 border border-[#262A33] bg-[#0B0C0E] px-2.5 py-1.5 font-mono text-[10px] text-[#F3F1EC] hover:border-[#D97736]"
          >
            {copiedJson ? (
              <>
                <Check className="h-3 w-3 text-[#1F9D68]" />
                COPIED JSON
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 text-[#9499A3]" />
                COPY RECEIPT
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadJson}
            className="flex items-center gap-1 border border-[#D97736] bg-[#261810] px-2.5 py-1.5 font-mono text-[10px] font-semibold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E]"
          >
            <Download className="h-3 w-3" />
            EXPORT .JSON
          </button>
        </div>
      </div>

      {/* Telemetry Metrics Strip */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono">
        <div className="border border-[#262A33] bg-[#0B0C0E] p-2">
          <div className="text-[10px] text-[#9499A3]">NODES SCANNED</div>
          <div className="mt-0.5 text-xs font-bold tabular-nums text-[#F3F1EC]">
            {activeReceipt.telemetry.nodesScanned} vertices
          </div>
        </div>
        <div className="border border-[#262A33] bg-[#0B0C0E] p-2">
          <div className="text-[10px] text-[#9499A3]">EDGES TRAVERSED</div>
          <div className="mt-0.5 text-xs font-bold tabular-nums text-[#F3F1EC]">
            {activeReceipt.telemetry.edgesTraversed} directed edges
          </div>
        </div>
        <div className="border border-[#262A33] bg-[#0B0C0E] p-2">
          <div className="text-[10px] text-[#9499A3]">EVALUATED DEPTH</div>
          <div className="mt-0.5 text-xs font-bold tabular-nums text-[#E5A93C]">
            {activeReceipt.telemetry.maxHopDepth} Hop
            {activeReceipt.telemetry.maxHopDepth > 1 ? 's' : ''}
          </div>
        </div>
        <div className="border border-[#262A33] bg-[#0B0C0E] p-2">
          <div className="text-[10px] text-[#9499A3]">EXECUTION LATENCY</div>
          <div className="mt-0.5 text-xs font-bold tabular-nums text-[#1F9D68]">
            {activeReceipt.telemetry.executionLatencyMs.toFixed(2)} ms
          </div>
        </div>
      </div>

      {/* Deterministic Hop-by-Hop Evidence Narrative */}
      <div className="mt-3 border border-[#262A33] bg-[#0B0C0E] p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[10px] font-semibold tracking-wider text-[#E5A93C] uppercase">
            DETERMINISTIC HOP-BY-HOP EVIDENCE CHAIN (ZERO-HALLUCINATION)
          </span>
          <button
            type="button"
            onClick={() => void requestGeminiExecutiveSummary()}
            disabled={isGeneratingAiNarrative}
            className="flex items-center gap-1 border border-[#D97736]/60 bg-[#261810] px-2 py-0.5 font-mono text-[10px] text-[#E5A93C] hover:border-[#E5A93C] disabled:opacity-50"
          >
            <Sparkles className="h-2.5 w-2.5" />
            {isGeneratingAiNarrative
              ? 'SYNTHESIZING GEMINI BRIEF...'
              : activeReceipt.geminiExecutiveSummary
                ? 'REFRESH GEMINI BRIEF'
                : 'ADD GEMINI EXECUTIVE BRIEF'}
          </button>
        </div>

        <p className="font-mono text-xs leading-relaxed text-[#F3F1EC]">
          {activeReceipt.deterministicNarrative}
        </p>

        {/* Optional Gemini Structured Executive Summary */}
        {activeReceipt.geminiExecutiveSummary && (
          <div className="mt-2.5 border-t border-[#262A33] pt-2.5">
            <div className="mb-1 font-mono text-[10px] font-semibold text-[#D97736]">
              GEMINI 2.5 FLASH EXECUTIVE COMPLIANCE SUMMARY:
            </div>
            <p className="text-xs leading-relaxed text-[#9499A3]">
              {activeReceipt.geminiExecutiveSummary}
            </p>
          </div>
        )}

        {/* Evidence Hop Table */}
        {activeReceipt.evidenceChain.length > 0 && (
          <div className="mt-2.5 space-y-1.5 border-t border-[#262A33] pt-2.5">
            {activeReceipt.evidenceChain.map((item, idx) => (
              <div
                key={`${item.txHash}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 border border-[#262A33] bg-[#131519] px-2.5 py-1.5 font-mono text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <span className="border border-[#D97736]/50 bg-[#261810] px-1.5 py-0.5 text-[10px] font-bold text-[#E5A93C]">
                    HOP {item.hopNumber}
                  </span>
                  <span className="text-[#F3F1EC]">{item.fromLabel}</span>
                  <span className="text-[#646973]">→</span>
                  <span className="text-[#F3F1EC]">{item.toLabel}</span>
                </div>
                <div className="flex items-center gap-2 tabular-nums">
                  <span className="font-semibold text-[#1F9D68]">
                    ${item.amountUsd.toLocaleString()} {item.token}
                  </span>
                  <span className="text-[10px] text-[#9499A3]">
                    TX: {item.txHash.slice(0, 10)}...
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cryptographic Audit Hash Footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border border-[#262A33] bg-[#0B0C0E] px-3 py-2 font-mono text-[10px]">
        <div className="flex items-center gap-1.5 text-[#9499A3]">
          <Hash className="h-3.5 w-3.5 text-[#D97736]" />
          <span>SHA-256 COMMITMENT HASH:</span>
        </div>
        <span className="break-all font-semibold text-[#E5A93C] tabular-nums">
          {activeReceipt.sha256CommitmentHash}
        </span>
      </div>
    </div>
  );
}
