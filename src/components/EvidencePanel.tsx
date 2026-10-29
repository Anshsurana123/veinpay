'use client';

import React, { useState } from 'react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { TopologicalGraphCanvas } from './TopologicalGraphCanvas';

export function EvidencePanel() {
  const {
    activeScan,
    activeReceipt,
    requestGeminiExecutiveSummary,
    isGeneratingAiNarrative,
    showRawGsqlInspector,
    setShowRawGsqlInspector,
    sybilClusterExpanded,
    setSybilClusterExpanded,
  } = useVeilPayStore();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedHopIndex, setSelectedHopIndex] = useState<number | null>(null);

  if (!activeScan) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleCopyReceipt = () => {
    if (!activeReceipt) return;
    void navigator.clipboard.writeText(JSON.stringify(activeReceipt, null, 2));
    showToast('Receipt JSON copied');
  };

  const handleExportJson = () => {
    if (!activeReceipt) return;
    const blob = new Blob([JSON.stringify(activeReceipt, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veilpay-receipt-${activeReceipt.receiptId.toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Downloaded receipt.json');
  };

  const evidenceHops = activeReceipt?.evidenceChain ?? [];

  return (
    <details className="group bg-[#16252f] border border-[#27404f] rounded-2xl p-4 sm:p-5 mb-3 transition-colors">
      <summary className="cursor-pointer text-[#8ea5b4] hover:text-[#eaf0f3] font-medium list-none flex justify-between items-center text-sm select-none">
        <span className="font-semibold text-[#eaf0f3]">Evidence and receipt</span>
        <span className="text-base font-mono group-open:hidden">+</span>
        <span className="text-base font-mono hidden group-open:inline">–</span>
      </summary>

      <div className="mt-4 pt-3 border-t border-[#27404f]">
        {/* Interactive Topological Graph Canvas */}
        <div className="rounded-xl overflow-hidden border border-[#27404f] mb-3">
          <TopologicalGraphCanvas />
        </div>

        {/* Quick Graph Toggles */}
        <div className="flex gap-2 flex-wrap mb-3">
          <button
            type="button"
            onClick={() => setSybilClusterExpanded(!sybilClusterExpanded)}
            className={`border rounded-full py-1 px-3 text-xs cursor-pointer transition-colors ${
              sybilClusterExpanded
                ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
                : 'border-[#27404f] text-[#8ea5b4] hover:text-[#eaf0f3]'
            }`}
          >
            {sybilClusterExpanded ? 'Collapse sybil group' : 'Expand sybil group'}
          </button>
          <button
            type="button"
            onClick={() => setShowRawGsqlInspector(!showRawGsqlInspector)}
            className={`border rounded-full py-1 px-3 text-xs cursor-pointer transition-colors ${
              showRawGsqlInspector
                ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
                : 'border-[#27404f] text-[#8ea5b4] hover:text-[#eaf0f3]'
            }`}
          >
            {showRawGsqlInspector
              ? 'Hide raw TigerGraph / GSQL'
              : 'Raw TigerGraph JSON + GSQL'}
          </button>
        </div>

        {/* Inspection Hint / Detail */}
        {selectedHopIndex !== null && evidenceHops[selectedHopIndex] ? (
          <div className="bg-[#0f1a21] border border-[#27404f] rounded-xl p-3 text-xs text-[#eaf0f3] mb-3 leading-relaxed">
            <span className="text-[#8ea5b4]">Hop {evidenceHops[selectedHopIndex].hopNumber}: </span>
            <span className="font-mono">{evidenceHops[selectedHopIndex].fromAddress}</span> →{' '}
            <span className="font-mono">{evidenceHops[selectedHopIndex].toAddress}</span>
            {evidenceHops[selectedHopIndex].amountUsd !== undefined && (
              <span className="text-[#7fd6b0] ml-2">
                (${evidenceHops[selectedHopIndex].amountUsd.toLocaleString()})
              </span>
            )}
            {evidenceHops[selectedHopIndex].fromRiskTag !== 'CLEAN' && (
              <span className="text-[#f28b7b] ml-2 font-medium">
                [{evidenceHops[selectedHopIndex].fromRiskTag}]
              </span>
            )}
          </div>
        ) : (
          <div className="bg-[#0f1a21] border border-[#27404f] rounded-xl p-3 text-xs text-[#8ea5b4] mb-3">
            Tap a hop or node to inspect it.
          </div>
        )}

        {/* Real Hop List */}
        <ul className="list-none p-0 m-0 mb-3">
          {evidenceHops.length > 0 ? (
            evidenceHops.map((h, i) => (
              <li
                key={i}
                onClick={() => setSelectedHopIndex(i)}
                className={`flex justify-between items-center gap-2 py-2 px-2 border-t border-[#27404f] text-[13px] cursor-pointer rounded transition-colors ${
                  selectedHopIndex === i
                    ? 'bg-[#1c2f3b] text-[#eaf0f3]'
                    : 'hover:bg-[#1c2f3b]/40 text-[#eaf0f3]'
                }`}
              >
                <span className="truncate">
                  Hop {h.hopNumber} · {h.fromLabel || `${h.fromAddress.slice(0, 6)}…${h.fromAddress.slice(-4)}`} → {h.toLabel || `${h.toAddress.slice(0, 6)}…${h.toAddress.slice(-4)}`}
                </span>
                <span className="text-[#8ea5b4] text-xs font-mono shrink-0">
                  {h.amountUsd !== undefined
                    ? `$${h.amountUsd.toLocaleString()}`
                    : '—'}
                </span>
              </li>
            ))
          ) : (
            <li className="py-2 text-xs text-[#8ea5b4] border-t border-[#27404f]">
              {activeScan.edgesTraversed === 0
                ? 'No prior transfers found for this address.'
                : `${activeScan.edgesTraversed} transfer edge(s) traversed without taint or threat flags.`}
            </li>
          )}
        </ul>

        {/* Real Key-Value Stats */}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
            Wallets scanned
            <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
              {activeScan.nodesScanned}
            </b>
          </div>
          <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
            Transfers traversed
            <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
              {activeScan.edgesTraversed}
            </b>
          </div>
          <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
            Depth
            <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
              {activeScan.maxHopsQueried} {activeScan.maxHopsQueried === 1 ? 'hop' : 'hops'}
            </b>
          </div>
          <div className="bg-[#0f1a21] rounded-xl p-2.5 text-xs text-[#8ea5b4]">
            Latency
            <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
              {activeScan.executionTimeMs.toFixed(2)} ms
            </b>
          </div>
        </div>

        {/* Receipt Audit Hash */}
        {activeReceipt && (
          <p className="font-mono text-xs text-[#8ea5b4] break-all mt-3">
            Receipt {activeReceipt.receiptId} · {activeReceipt.cryptographicAuditHash}
          </p>
        )}

        {/* Receipt Action Chips */}
        <div className="flex gap-2 flex-wrap mt-3">
          <button
            type="button"
            onClick={handleCopyReceipt}
            className="border border-[#27404f] rounded-full py-1 px-3 text-xs text-[#8ea5b4] hover:text-[#eaf0f3] hover:border-[#efe6d2] cursor-pointer transition-colors"
          >
            Copy receipt
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="border border-[#27404f] rounded-full py-1 px-3 text-xs text-[#8ea5b4] hover:text-[#eaf0f3] hover:border-[#efe6d2] cursor-pointer transition-colors"
          >
            Export JSON
          </button>
          <button
            type="button"
            disabled={isGeneratingAiNarrative}
            onClick={() => void requestGeminiExecutiveSummary()}
            className="border border-[#27404f] rounded-full py-1 px-3 text-xs text-[#8ea5b4] hover:text-[#eaf0f3] hover:border-[#efe6d2] cursor-pointer transition-colors disabled:opacity-50"
          >
            {isGeneratingAiNarrative
              ? 'Generating…'
              : activeReceipt?.geminiExecutiveSummary
              ? 'Regenerate Gemini summary'
              : 'Add Gemini summary'}
          </button>
        </div>

        {/* Gemini Narrative if present */}
        {activeReceipt?.geminiExecutiveSummary && (
          <div className="bg-[#0f1a21] border border-[#27404f] rounded-xl p-3 mt-3 text-[13px] text-[#eaf0f3] leading-relaxed">
            <span className="font-semibold text-[#e8c06a]">Gemini summary: </span>
            {activeReceipt.geminiExecutiveSummary}
          </div>
        )}

        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed left-1/2 bottom-6 -translate-x-1/2 bg-[#efe6d2] text-[#14212a] py-2 px-4 rounded-full font-semibold z-50 text-sm shadow-xl">
            {toastMessage}
          </div>
        )}
      </div>
    </details>
  );
}
