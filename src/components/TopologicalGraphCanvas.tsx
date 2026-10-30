'use client';

import React, { useMemo } from 'react';
import {
  Network,
  Code2,
  Layers,
  RotateCcw,
} from 'lucide-react';
import { useVeinPayStore } from '@/store/veinpay-store';
import { getChainDisplayName } from '@/lib/socket/tokens';
import type { GraphEdge, GraphVertex } from '@/types/veinpay';

interface PositionedNode {
  vertex: GraphVertex;
  x: number;
  y: number;
  hop: number;
}

export function TopologicalGraphCanvas() {
  const {
    activeScan,
    linkConfig,
    selectedGraphNodeId,
    selectedGraphEdgeId,
    sybilClusterExpanded,
    showRawGsqlInspector,
    setSelectedGraphNodeId,
    setSelectedGraphEdgeId,
    setSybilClusterExpanded,
    setShowRawGsqlInspector,
  } = useVeinPayStore();

  const layout = useMemo(() => {
    if (!activeScan) {
      return {
        nodes: [] as PositionedNode[],
        nodeById: new Map<string, PositionedNode>(),
        edges: [] as GraphEdge[],
        gateX: 605,
        vaultX: 735,
      };
    }

    const { vertices, edges } = activeScan;
    const payerLower = activeScan.targetWallet.toLowerCase();

    const byHop = new Map<number, GraphVertex[]>();
    let sybilSiblingShownCount = 0;

    for (const v of vertices) {
      if (v.riskTag === 'MERCHANT_VAULT') continue;
      let hop = Math.max(0, v.hopDistance ?? 1);
      if (v.id.toLowerCase() === payerLower) {
        hop = 0;
      }
      if (!sybilClusterExpanded && v.isSybilSibling && hop > 0) {
        sybilSiblingShownCount++;
        if (sybilSiblingShownCount > 3) continue;
      }

      const list = byHop.get(hop) ?? [];
      list.push(v);
      byHop.set(hop, list);
    }

    const maxHopPresent = Math.max(1, ...Array.from(byHop.keys()));
    const positionedNodes: PositionedNode[] = [];
    const nodeById = new Map<string, PositionedNode>();

    for (const [hop, hopVertices] of byHop.entries()) {
      const x =
        hop === 0
          ? 470
          : Math.max(85, 470 - (hop / Math.max(maxHopPresent, 2)) * 375);

      const count = hopVertices.length;
      hopVertices.forEach((v, idx) => {
        const usableHeight = 220;
        const y = count === 1 ? 145 : 35 + (idx / (count - 1)) * usableHeight;
        const pNode: PositionedNode = { vertex: v, x, y, hop };
        positionedNodes.push(pNode);
        nodeById.set(v.id.toLowerCase(), pNode);
      });
    }

    const visibleEdges = edges.filter(
      (e) =>
        nodeById.has(e.from_id.toLowerCase()) &&
        nodeById.has(e.to_id.toLowerCase())
    );

    return {
      nodes: positionedNodes,
      nodeById,
      edges: visibleEdges,
      gateX: 605,
      vaultX: 735,
    };
  }, [activeScan, sybilClusterExpanded]);

  if (!activeScan) {
    return (
      <div className="flex h-72 items-center justify-center border border-[#262A33] bg-[#0B0C0E] font-mono text-xs text-[#9499A3]">
        INITIALIZING TIGERGRAPH SUBGRAPH TELEMETRY...
      </div>
    );
  }

  const evidenceSet = new Set(
    activeScan.evidenceEdges.map((e) => e.attributes.tx_hash)
  );
  const selectedVertex = activeScan.vertices.find(
    (v) => v.id.toLowerCase() === selectedGraphNodeId?.toLowerCase()
  );
  const selectedEdge = activeScan.edges.find(
    (e) => e.attributes.tx_hash === selectedGraphEdgeId
  );

  const isBlocked = !activeScan.socketUnlocked;
  const isWarningOrBypass =
    activeScan.verdict === 'WARNING_SYBIL' ||
    activeScan.verdict === 'ADVISORY_BYPASSED' ||
    (activeScan.verdict === 'INCONCLUSIVE' && activeScan.socketUnlocked);

  return (
    <div className="border border-[#262A33] bg-[#131519]">
      {/* Graph Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262A33] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-[#D97736]" />
          <span className="font-mono text-xs font-semibold tracking-wider text-[#F3F1EC] uppercase">
            MODULE C // TIGERGRAPH 2D TOPOLOGICAL SUBGRAPH
          </span>
          <span className="border border-[#262A33] bg-[#0B0C0E] px-2 py-0.5 font-mono text-[10px] tabular-nums text-[#E5A93C]">
            {activeScan.nodesScanned} VERTICES · {activeScan.edgesTraversed}{' '}
            EDGES · DEPTH {activeScan.maxHopsQueried}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeScan.sybilClusterSize >= 3 && (
            <button
              type="button"
              onClick={() => setSybilClusterExpanded(!sybilClusterExpanded)}
              className="flex items-center gap-1 border border-[#D99B26]/60 bg-[#2B210D] px-2 py-1 font-mono text-[10px] font-semibold text-[#D99B26] hover:border-[#E5A93C]"
            >
              <Layers className="h-3 w-3" />
              {sybilClusterExpanded
                ? `COLLAPSE SYBIL BUNDLE (${activeScan.sybilClusterSize})`
                : `EXPAND SYBIL BUNDLE (${activeScan.sybilClusterSize} WALLETS)`}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowRawGsqlInspector(!showRawGsqlInspector)}
            className={`flex items-center gap-1 border px-2 py-1 font-mono text-[10px] font-semibold transition-colors ${
              showRawGsqlInspector
                ? 'border-[#D97736] bg-[#D97736] text-[#0B0C0E]'
                : 'border-[#262A33] bg-[#1A1D23] text-[#9499A3] hover:text-[#F3F1EC]'
            }`}
          >
            <Code2 className="h-3 w-3" />
            {showRawGsqlInspector
              ? 'HIDE RAW RESTPP / GSQL'
              : 'RAW RESTPP JSON & GSQL'}
          </button>
        </div>
      </div>

      {/* Interactive SVG Graph Canvas */}
      <div className="relative bg-[#0B0C0E] bg-precision-grid">
        <svg
          viewBox="0 0 820 290"
          className="h-[290px] w-full select-none"
          role="img"
          aria-label="TigerGraph Multi-Hop Pre-Sign Firewall Subgraph"
        >
          <defs>
            <marker
              id="arrow-clean"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#1F9D68" />
            </marker>
            <marker
              id="arrow-taint"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#D6453A" />
            </marker>
            <marker
              id="arrow-amber"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#D99B26" />
            </marker>
            <marker
              id="arrow-muted"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#646973" />
            </marker>
          </defs>

          <text
            x="110"
            y="18"
            fill="#646973"
            fontSize="9"
            fontFamily="monospace"
            textAnchor="middle"
          >
            UPSTREAM LINEAGE (HOPS 1–{activeScan.maxHopsQueried})
          </text>
          <text
            x="470"
            y="18"
            fill="#9499A3"
            fontSize="9"
            fontFamily="monospace"
            textAnchor="middle"
          >
            PAYER WALLET (HOP 0)
          </text>
          <text
            x="605"
            y="18"
            fill="#D97736"
            fontSize="9"
            fontFamily="monospace"
            textAnchor="middle"
          >
            FIREWALL GATE
          </text>
          <text
            x="735"
            y="18"
            fill="#E5A93C"
            fontSize="9"
            fontFamily="monospace"
            textAnchor="middle"
          >
            CAKE WALLET VAULT
          </text>

          {/* Directed Edges */}
          {layout.edges.map((edge, idx) => {
            const fromNode = layout.nodeById.get(edge.from_id.toLowerCase());
            const toNode = layout.nodeById.get(edge.to_id.toLowerCase());
            if (!fromNode || !toNode) return null;

            const isSelfLoop =
              fromNode.vertex.id.toLowerCase() ===
              toNode.vertex.id.toLowerCase();
            const isContagion =
              evidenceSet.has(edge.attributes.tx_hash) ||
              edge.attributes.is_taint_path ||
              edge.attributes.is_sybil_fanout;
            const isSelected = selectedGraphEdgeId === edge.attributes.tx_hash;

            const strokeColor = isContagion
              ? isBlocked
                ? '#D6453A'
                : '#D99B26'
              : '#363B47';
            const markerEnd = isContagion
              ? isBlocked
                ? 'url(#arrow-taint)'
                : 'url(#arrow-amber)'
              : 'url(#arrow-muted)';

            if (isSelfLoop) {
              return (
                <g
                  key={`${edge.attributes.tx_hash}-${idx}`}
                  onClick={() => {
                    setSelectedGraphEdgeId(edge.attributes.tx_hash);
                    setSelectedGraphNodeId(null);
                  }}
                  className="cursor-pointer"
                >
                  <path
                    d={`M ${fromNode.x} ${fromNode.y - 16} C ${fromNode.x - 28} ${fromNode.y - 52}, ${fromNode.x + 28} ${fromNode.y - 52}, ${fromNode.x} ${fromNode.y - 16}`}
                    fill="none"
                    stroke="#D99B26"
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    strokeDasharray="3 2"
                  />
                </g>
              );
            }

            const midX = (fromNode.x + toNode.x) / 2;
            const midY = (fromNode.y + toNode.y) / 2;

            return (
              <g
                key={`${edge.attributes.tx_hash}-${idx}`}
                onClick={() => {
                  setSelectedGraphEdgeId(edge.attributes.tx_hash);
                  setSelectedGraphNodeId(null);
                }}
                className="cursor-pointer"
              >
                <line
                  x1={fromNode.x + 22}
                  y1={fromNode.y}
                  x2={toNode.x - 22}
                  y2={toNode.y}
                  stroke={strokeColor}
                  strokeWidth={isSelected ? 3 : isContagion ? 2.2 : 1.3}
                  strokeDasharray={isContagion ? '6 3' : undefined}
                  markerEnd={markerEnd}
                />
                <rect
                  x={midX - 24}
                  y={midY - 8}
                  width="48"
                  height="14"
                  fill="#0B0C0E"
                  stroke={isSelected ? '#E5A93C' : '#262A33'}
                  strokeWidth="0.8"
                />
                <text
                  x={midX}
                  y={midY + 2}
                  fill={isContagion ? '#F3F1EC' : '#9499A3'}
                  fontSize="8"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  ${edge.attributes.amount_usd.toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* Payer -> Firewall Gate -> Cake Wallet Vault Pipeline Edges */}
          <line
            x1="495"
            y1="145"
            x2="580"
            y2="145"
            stroke={
              isBlocked ? '#D6453A' : isWarningOrBypass ? '#D99B26' : '#1F9D68'
            }
            strokeWidth="2.2"
            markerEnd={
              isBlocked
                ? 'url(#arrow-taint)'
                : isWarningOrBypass
                  ? 'url(#arrow-amber)'
                  : 'url(#arrow-clean)'
            }
          />

          <line
            x1="630"
            y1="145"
            x2="705"
            y2="145"
            stroke={isBlocked ? '#262A33' : '#1F9D68'}
            strokeWidth="2.2"
            strokeDasharray={isBlocked ? '4 4' : undefined}
            markerEnd={isBlocked ? 'url(#arrow-muted)' : 'url(#arrow-clean)'}
          />

          {/* VeinPay Firewall Gate Node */}
          <g transform={`translate(${layout.gateX}, 145)`}>
            <rect
              x="-26"
              y="-24"
              width="52"
              height="48"
              fill={
                isBlocked
                  ? '#2D1412'
                  : isWarningOrBypass
                    ? '#2B210D'
                    : '#0E291E'
              }
              stroke={
                isBlocked
                  ? '#D6453A'
                  : isWarningOrBypass
                    ? '#D99B26'
                    : '#1F9D68'
              }
              strokeWidth="2"
            />
            <text
              x="0"
              y="-4"
              fill="#F3F1EC"
              fontSize="8"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              {isBlocked ? 'BLOCKED' : isWarningOrBypass ? 'WARN/BYP' : 'CLEARED'}
            </text>
            <text
              x="0"
              y="9"
              fill={
                isBlocked
                  ? '#D6453A'
                  : isWarningOrBypass
                    ? '#D99B26'
                    : '#1F9D68'
              }
              fontSize="7.5"
              fontFamily="monospace"
              textAnchor="middle"
            >
              {activeScan.executionTimeMs.toFixed(1)}ms
            </text>
          </g>

          {/* Cake Wallet Destination Vault Node */}
          <g transform={`translate(${layout.vaultX}, 145)`}>
            <rect
              x="-32"
              y="-24"
              width="64"
              height="48"
              fill={isBlocked ? '#131519' : '#261810'}
              stroke={isBlocked ? '#363B47' : '#D97736'}
              strokeWidth="1.8"
            />
            <text
              x="0"
              y="-5"
              fill={isBlocked ? '#646973' : '#E5A93C'}
              fontSize="8"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="middle"
            >
              {isBlocked ? 'VAULT LOCKED' : 'CAKE VAULT'}
            </text>
            <text
              x="0"
              y="8"
              fill="#9499A3"
              fontSize="7.5"
              fontFamily="monospace"
              textAnchor="middle"
            >
              {linkConfig.asset} (
              {getChainDisplayName(linkConfig.destinationChainId)})
            </text>
          </g>

          {/* Subgraph Vertices */}
          {layout.nodes.map(({ vertex, x, y, hop }) => {
            const cat = vertex.riskTag;
            const isFlagged =
              vertex.isTainted ||
              cat === 'APPROVAL_DRAINER' ||
              cat === 'SANCTIONED_MIXER' ||
              cat === 'EXPLOIT_CONTRACT' ||
              cat === 'POISON_DUST_FACTORY';
            const isSybil =
              cat === 'SYBIL_ROOT_FUNDER' ||
              cat === 'SYBIL_SIBLING' ||
              cat === 'WASH_CYCLE_NODE' ||
              cat === 'INTERMEDIATE_MULE';
            const isPayer = hop === 0;
            const isSelected =
              selectedGraphNodeId?.toLowerCase() === vertex.id.toLowerCase();

            const fill = isFlagged
              ? '#2D1412'
              : isSybil
                ? '#2B210D'
                : isPayer
                  ? '#1A1D23'
                  : '#0E291E';
            const stroke = isSelected
              ? '#F3F1EC'
              : isFlagged
                ? '#D6453A'
                : isSybil
                  ? '#D99B26'
                  : isPayer
                    ? '#D97736'
                    : '#1F9D68';

            return (
              <g
                key={vertex.id}
                transform={`translate(${x}, ${y})`}
                onClick={() => {
                  setSelectedGraphNodeId(vertex.id);
                  setSelectedGraphEdgeId(null);
                }}
                className="cursor-pointer"
              >
                <rect
                  x="-38"
                  y="-17"
                  width="76"
                  height="34"
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={isSelected ? '2.4' : '1.5'}
                />
                <text
                  x="0"
                  y="-3"
                  fill="#F3F1EC"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {vertex.label.slice(0, 13)}
                </text>
                <text
                  x="0"
                  y="9"
                  fill="#9499A3"
                  fontSize="7.5"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {vertex.id.slice(0, 6)}..{vertex.id.slice(-4)}
                </text>
                <rect
                  x="-38"
                  y="-27"
                  width="32"
                  height="10"
                  fill="#0B0C0E"
                  stroke={stroke}
                  strokeWidth="0.8"
                />
                <text
                  x="-22"
                  y="-20"
                  fill={stroke}
                  fontSize="6.5"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  HOP {hop}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Bottom Legend & Cycle / Sybil Indicators */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#262A33] bg-[#131519]/90 px-3.5 py-2 font-mono text-[10px]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-[#1F9D68]">
              <span className="h-2 w-2 bg-[#1F9D68]" /> CLEAN LINEAGE
            </span>
            <span className="flex items-center gap-1.5 text-[#D6453A]">
              <span className="h-2 w-2 bg-[#D6453A]" /> DRAINER / TAINT / POISON
            </span>
            <span className="flex items-center gap-1.5 text-[#D99B26]">
              <span className="h-2 w-2 bg-[#D99B26]" /> SYBIL CLUSTER / MULE
            </span>
            {(activeScan.cyclicLoopDetected ||
              activeScan.selfTransferDetected) && (
              <span className="flex items-center gap-1 border border-[#D99B26]/50 bg-[#2B210D] px-1.5 py-0.5 text-[#D99B26]">
                <RotateCcw className="h-2.5 w-2.5" />
                CYCLIC WASH LOOP / SELF-TRANSFER GUARDED
              </span>
            )}
          </div>
          <span className="text-[#9499A3]">
            CLICK ANY VERTEX OR EDGE TO INSPECT LINEAGE
          </span>
        </div>
      </div>

      {/* Interactive Node / Edge Click Inspector */}
      {(selectedVertex || selectedEdge) && (
        <div className="border-t border-[#262A33] bg-[#1A1D23] p-3 font-mono text-xs">
          {selectedVertex && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#E5A93C]">
                    VERTEX INSPECTOR // {selectedVertex.label}
                  </span>
                  <span className="border border-[#262A33] bg-[#0B0C0E] px-1.5 py-0.5 text-[10px] text-[#F3F1EC]">
                    {selectedVertex.riskTag}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[#9499A3]">
                  ADDRESS:{' '}
                  <span className="text-[#F3F1EC]">{selectedVertex.id}</span> ·
                  HOP DISTANCE:{' '}
                  <span className="text-[#E5A93C]">
                    {selectedVertex.hopDistance}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedGraphNodeId(null)}
                className="border border-[#262A33] bg-[#0B0C0E] px-2 py-1 text-[10px] text-[#9499A3] hover:text-[#F3F1EC]"
              >
                CLOSE
              </button>
            </div>
          )}

          {selectedEdge && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#E5A93C]">
                    DIRECTED EDGE // {selectedEdge.e_type}
                  </span>
                  <span className="border border-[#262A33] bg-[#0B0C0E] px-1.5 py-0.5 text-[10px] text-[#1F9D68]">
                    ${selectedEdge.attributes.amount_usd.toLocaleString()}{' '}
                    {selectedEdge.attributes.token}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[#9499A3]">
                  FROM: {selectedEdge.from_id.slice(0, 10)}... → TO:{' '}
                  {selectedEdge.to_id.slice(0, 10)}... · TX HASH:{' '}
                  <span className="text-[#F3F1EC]">
                    {selectedEdge.attributes.tx_hash}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedGraphEdgeId(null)}
                className="border border-[#262A33] bg-[#0B0C0E] px-2 py-1 text-[10px] text-[#9499A3] hover:text-[#F3F1EC]"
              >
                CLOSE
              </button>
            </div>
          )}
        </div>
      )}

      {/* Raw TigerGraph RESTPP JSON & GSQL Query Drawer */}
      {showRawGsqlInspector && (
        <div className="border-t border-[#262A33] bg-[#0B0C0E] p-3.5 space-y-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
              <span className="font-semibold text-[#E5A93C]">
                RAW TIGERGRAPH RESTPP v2 PAYLOAD &amp; GSQL ACCUMULATOR OUTPUT
              </span>
              <span className="text-[#9499A3]">
                /restpp/query/VeinPayGraph/veinpay_firewall_check
              </span>
            </div>
            <pre className="max-h-48 overflow-auto border border-[#262A33] bg-[#131519] p-3 font-mono text-[10px] leading-relaxed text-[#F3F1EC]">
              {JSON.stringify(activeScan.restppEnvelope, null, 2)}
            </pre>
          </div>

          <div>
            <div className="mb-1 font-mono text-[11px] font-semibold text-[#D97736]">
              EXECUTED GSQL QUERY SNIPPET (/tigergraph/veinpay_firewall.gsql):
            </div>
            <pre className="max-h-36 overflow-auto border border-[#262A33] bg-[#131519] p-3 font-mono text-[10px] leading-relaxed text-[#9499A3]">
              {activeScan.gsqlQuerySnippet}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
