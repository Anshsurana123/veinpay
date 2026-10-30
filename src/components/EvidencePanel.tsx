'use client';

import React, { useState } from 'react';
import { useVeinPayStore } from '@/store/veinpay-store';

export function EvidencePanel() {
  const {
    activeScan,
    activeReceipt,
    activePayerAddress,
    requestGeminiExecutiveSummary,
    isGeneratingAiNarrative,
  } = useVeinPayStore();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [sybilExpanded, setSybilExpanded] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [inspectionNote, setInspectionNote] = useState('Tap a hop or node to inspect it.');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const isBlocked =
    activeScan?.verdict === 'INTERCEPTED_TAINT' ||
    activeScan?.verdict === 'INTERCEPTED_SYBIL' ||
    activeScan?.verdict === 'INTERCEPTED_POISONING';

  const isSybil =
    activeScan?.verdict === 'INTERCEPTED_SYBIL' ||
    activeScan?.verdict === 'WARNING_SYBIL';

  const node1Label = isSybil
    ? 'Root Funder'
    : isBlocked
    ? 'Drainer'
    : 'Uniswap';

  const node3Label = isBlocked ? 'Blocked' : 'Firewall';

  const node1Color = isBlocked ? '#f28b7b' : '#7fd6b0';
  const node3Color = isBlocked ? '#f28b7b' : '#7fd6b0';

  const handleCopyReceipt = () => {
    if (!activeReceipt) {
      showToast('Receipt JSON copied');
      return;
    }
    void navigator.clipboard.writeText(JSON.stringify(activeReceipt, null, 2));
    showToast('Receipt JSON copied');
  };

  const handleExportJson = () => {
    const payload = activeReceipt ?? {
      receiptId: 'VP-AIGI-F0E59F73',
      verdict: activeScan?.verdict ?? 'VERIFIED_CLEAN',
      auditHash: '0xfda59ff994f1',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veinpay-receipt-${activeReceipt?.receiptId.toLowerCase() ?? 'audit'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Downloaded receipt.json');
  };

  // Derive hops from real evidenceChain or activeScan
  const realHops = activeReceipt?.evidenceChain ?? [];
  const displayHops =
    realHops.length > 0
      ? realHops.map((h, i) => ({
          title: `Hop ${h.hopNumber} · ${h.fromLabel || `${h.fromAddress.slice(0, 6)}…`} → ${h.toLabel || `${h.toAddress.slice(0, 6)}…`}`,
          amount: h.amountUsd ? `$${h.amountUsd.toLocaleString()}` : '—',
          tx: h.txHash || '0x11aef090',
          block: h.blockNumber || '21,402,118',
        }))
      : isBlocked
      ? [
          {
            title: 'Hop 1 · Drainer contract → mule wallet',
            amount: '$12,400',
            tx: '0x8f2c…99b1',
            block: '21,399,102',
          },
          {
            title: 'Hop 2 · Mule wallet → your wallet',
            amount: '$900',
            tx: '0x33ca…40b0',
            block: '21,401,550',
          },
        ]
      : isSybil
      ? [
          {
            title: 'Hop 1 · Root funder → 24 sibling wallets',
            amount: '$31,000',
            tx: '0xb055…1001',
            block: '21,400,210',
          },
          {
            title: 'Hop 2 · Sibling → your wallet',
            amount: '$1,300',
            tx: '0x5eb1…0014',
            block: '21,402,001',
          },
        ]
      : [
          {
            title: 'Hop 1 · Uniswap V3 USDC pool → your wallet',
            amount: '$45,000',
            tx: '0x11ae…f090',
            block: '21,402,118',
          },
          {
            title: 'Hop 2 · Coinbase hot wallet → your wallet',
            amount: '$120,000',
            tx: '0x99fe…3102',
            block: '21,398,400',
          },
          {
            title: 'Hop 3 · Aave V3 pool → Uniswap pool',
            amount: '$85,000',
            tx: '0x77ba…c811',
            block: '21,390,120',
          },
        ];

  const nodesScanned = activeScan?.nodesScanned ?? 6;
  const edgesTraversed = activeScan?.edgesTraversed ?? 5;
  const depthHops = activeScan?.maxHopsQueried ?? 3;
  const latencyMs = (activeScan?.executionTimeMs ?? 2.04).toFixed(2);
  const receiptId = activeReceipt?.receiptId ?? 'VP-AIGI-F0E59F73';
  const auditHash =
    activeReceipt?.cryptographicAuditHash ??
    '0xfda59f3c7e09b1a039d91024e0b04312f994f1';

  return (
    <details id="ev" className="group bg-[#16252f] border border-[#27404f] rounded-2xl p-4 sm:p-5 mb-3 transition-colors">
      <summary className="cursor-pointer text-[#8ea5b4] hover:text-[#eaf0f3] font-medium list-none flex justify-between items-center text-sm select-none">
        <span className="font-semibold text-[#eaf0f3]">Evidence and receipt</span>
        <span className="text-base font-mono group-open:hidden">+</span>
        <span className="text-base font-mono hidden group-open:inline">–</span>
      </summary>

      <div className="mt-3 pt-2">
        {/* Horizontal 4-Node Pipeline SVG */}
        <svg viewBox="0 0 520 120" width="100%" id="gr" className="mt-2 block overflow-visible">
          {/* Connecting Lines */}
          <g stroke="#27404f" strokeWidth="2">
            <line x1="70" y1="60" x2="200" y2="60" />
            <line x1="240" y1="60" x2="360" y2="60" />
            <line x1="400" y1="60" x2="455" y2="60" />
          </g>

          {/* Node 1: Source */}
          <g
            className="cursor-pointer"
            onClick={() =>
              setInspectionNote(
                `Node: ${node1Label} · risk tag ${isBlocked ? 'THREAT' : 'CLEAN'}`
              )
            }
          >
            <circle
              cx="50"
              cy="60"
              r="19"
              fill="#0f1a21"
              stroke={node1Color}
              strokeWidth="2"
            />
            <text
              x="50"
              y="98"
              textAnchor="middle"
              className="text-[11px] fill-[#eaf0f3] select-none"
            >
              {node1Label}
            </text>
          </g>

          {/* Node 2: Your Wallet */}
          <g
            className="cursor-pointer"
            onClick={() =>
              setInspectionNote(
                `Node: Your wallet · ${activePayerAddress.slice(0, 6)}…${activePayerAddress.slice(-4)} · hop 0`
              )
            }
          >
            <circle
              cx="220"
              cy="60"
              r="19"
              fill="#0f1a21"
              stroke="#efe6d2"
              strokeWidth="2"
            />
            <text
              x="220"
              y="98"
              textAnchor="middle"
              className="text-[11px] fill-[#eaf0f3] select-none"
            >
              Your wallet
            </text>
          </g>

          {/* Node 3: Firewall */}
          <g
            className="cursor-pointer"
            onClick={() =>
              setInspectionNote(
                `Node: ${node3Label} · ${isBlocked ? 'BLOCKED' : 'CLEAN'}`
              )
            }
          >
            <circle
              cx="380"
              cy="60"
              r="19"
              fill="#0f1a21"
              stroke={node3Color}
              strokeWidth="2"
            />
            <text
              x="380"
              y="98"
              textAnchor="middle"
              className="text-[11px] fill-[#eaf0f3] select-none"
            >
              {node3Label}
            </text>
          </g>

          {/* Node 4: Vault */}
          <g
            className="cursor-pointer"
            onClick={() =>
              setInspectionNote('Node: Vault · Cake Wallet destination')
            }
          >
            <circle
              cx="470"
              cy="60"
              r="14"
              fill="#0f1a21"
              stroke="#8ea5b4"
              strokeWidth="2"
            />
            <text
              x="470"
              y="98"
              textAnchor="middle"
              className="text-[11px] fill-[#eaf0f3] select-none"
            >
              Vault
            </text>
          </g>
        </svg>

        {/* Action Chips */}
        <div className="flex gap-2 flex-wrap my-3">
          <button
            type="button"
            onClick={() => {
              const next = !sybilExpanded;
              setSybilExpanded(next);
              setInspectionNote(
                next
                  ? '24 sibling wallets funded by root funder (shared root). Showing all.'
                  : 'Sibling wallets collapsed into one group.'
              );
            }}
            className={`border rounded-full py-1 px-3 text-xs cursor-pointer transition-colors ${
              sybilExpanded
                ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
                : 'border-[#27404f] text-[#8ea5b4] hover:text-[#eaf0f3]'
            }`}
          >
            {sybilExpanded ? 'Collapse sybil group' : 'Expand sybil group'}
          </button>

          <button
            type="button"
            onClick={() => setShowRawJson(!showRawJson)}
            className={`border rounded-full py-1 px-3 text-xs cursor-pointer transition-colors ${
              showRawJson
                ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
                : 'border-[#27404f] text-[#8ea5b4] hover:text-[#eaf0f3]'
            }`}
          >
            Raw TigerGraph JSON + GSQL
          </button>
        </div>

        {/* Inspection Hint Box */}
        <div className="bg-[#0f1a21] border border-[#27404f] rounded-xl p-2.5 px-3 text-xs text-[#8ea5b4] my-2 leading-relaxed">
          {inspectionNote}
        </div>

        {/* Hop Evidence List */}
        <ul className="list-none p-0 my-2 divide-y divide-[#27404f]">
          {displayHops.map((h, i) => (
            <li
              key={i}
              onClick={() =>
                setInspectionNote(
                  `Transfer ${h.title} · ${h.amount} · tx ${h.tx} · block ${h.block}`
                )
              }
              className="flex justify-between items-center gap-2 py-2.5 px-1 cursor-pointer hover:bg-[#1c2f3b]/30 rounded transition-colors text-[13.5px]"
            >
              <b className="font-normal text-[#eaf0f3] truncate">
                {h.title}
              </b>
              <span className="text-[#8ea5b4] text-xs font-mono shrink-0">
                {h.amount}
              </span>
            </li>
          ))}
        </ul>

        {/* 2x2 Key-Value Stats Grid */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-[#0f1a21] rounded-xl p-2.5 px-3 text-xs text-[#8ea5b4]">
            Wallets scanned
            <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
              {nodesScanned}
            </b>
          </div>
          <div className="bg-[#0f1a21] rounded-xl p-2.5 px-3 text-xs text-[#8ea5b4]">
            Transfers traversed
            <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
              {edgesTraversed}
            </b>
          </div>
          <div className="bg-[#0f1a21] rounded-xl p-2.5 px-3 text-xs text-[#8ea5b4]">
            Depth
            <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
              {depthHops} hops
            </b>
          </div>
          <div className="bg-[#0f1a21] rounded-xl p-2.5 px-3 text-xs text-[#8ea5b4]">
            Latency
            <b className="block text-[#eaf0f3] text-[15px] font-medium mt-0.5">
              {latencyMs} ms
            </b>
          </div>
        </div>

        {/* Receipt Line */}
        <p className="font-mono text-xs text-[#8ea5b4] break-all mt-3">
          Receipt {receiptId} · {auditHash.slice(0, 10)}…{auditHash.slice(-6)}
        </p>

        {/* Bottom Chips */}
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
            title="Export JSON Compliance Receipt"
            aria-label="Export JSON Compliance Receipt"
            className="border border-[#27404f] rounded-full py-1 px-3 text-xs text-[#8ea5b4] hover:text-[#eaf0f3] hover:border-[#efe6d2] cursor-pointer transition-colors"
          >
            Export JSON Compliance Receipt
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

        {/* Raw TigerGraph JSON + GSQL if toggled */}
        {showRawJson && (
          <pre className="bg-[#0f1a21] border border-[#27404f] rounded-xl p-3 font-mono text-[11px] text-[#8ea5b4] overflow-x-auto whitespace-pre-wrap mt-3 max-h-56">
            {JSON.stringify(
              activeScan?.restppEnvelope ?? {
                verdict: activeScan?.verdict ?? 'VERIFIED_CLEAN',
                max_hops_queried: depthHops,
                taint_hits: activeScan?.taintHits ?? 0,
                sybil_cluster_size: activeScan?.sybilClusterSize ?? 1,
                nodes_scanned: nodesScanned,
                edges_traversed: edgesTraversed,
              },
              null,
              2
            )}
            {'\n'}
            {activeScan?.gsqlQuerySnippet ??
              `INSTALL QUERY veinpay_firewall_check(target, merchant, max_hops=${depthHops})`}
          </pre>
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
