'use client';

import React from 'react';
import { useVeilPayStore } from '@/store/veilpay-store';

export function JudgeStrip() {
  const { judgeMode, activeScan, lastMeasuredLatencyMs, totalThreatsIntercepted } =
    useVeilPayStore();

  if (!judgeMode) return null;

  const engineLabel =
    activeScan?.executionSource === 'TIGERGRAPH_RESTPP_LIVE'
      ? 'TigerGraph Live RESTPP'
      : activeScan?.executionSource === 'ETHERSCAN_V2_LIVE_CRAWL'
      ? 'Etherscan V2 Live Crawl'
      : 'In-memory GSQL';

  const latencyLabel = activeScan
    ? `${activeScan.executionTimeMs.toFixed(2)} ms`
    : `${lastMeasuredLatencyMs.toFixed(2)} ms`;

  return (
    <div
      role="region"
      aria-label="Judge View Engine Telemetry"
      className="flex items-center gap-4 flex-wrap text-[12.5px] text-[#8ea5b4] border border-dashed border-[#27404f] rounded-xl px-3 py-2 mb-3.5 bg-[#16252f]/40"
    >
      <span>
        Engine <b className="text-[#eaf0f3] font-medium">{engineLabel}</b>
      </span>
      <span>
        Traversal <b className="text-[#eaf0f3] font-medium">{latencyLabel}</b>
      </span>
      <span>
        Intercepted <b className="text-[#eaf0f3] font-medium">{totalThreatsIntercepted}</b>
      </span>
      {activeScan && (
        <span className="text-[#8ea5b4]">
          Topology{' '}
          <b className="text-[#eaf0f3] font-medium">
            {activeScan.nodesScanned} nodes · {activeScan.edgesTraversed} edges
          </b>
        </span>
      )}
    </div>
  );
}
