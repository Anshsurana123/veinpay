'use client';

import React, { useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Activity,
  Sliders,
  Wallet,
  Columns,
  ArrowUpRight,
} from 'lucide-react';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import { useVeilPayStore } from '@/store/veilpay-store';

export function TopTelemetryBar() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();

  const {
    activeScan,
    lastMeasuredLatencyMs,
    totalThreatsIntercepted,
    viewLayout,
    setViewLayout,
    setSettingsDrawerOpen,
    selectPersona,
    linkConfig,
  } = useVeilPayStore();

  useEffect(() => {
    if (isConnected && address) {
      selectPersona('custom', address);
    }
  }, [isConnected, address, selectPersona]);

  const sourceLabel =
    activeScan?.executionSource === 'TIGERGRAPH_RESTPP_LIVE'
      ? 'TIGERGRAPH 4.x RESTPP'
      : activeScan?.executionSource === 'ETHERSCAN_V2_LIVE_CRAWL'
        ? 'ETHERSCAN V2 + GSQL'
        : 'IN-MEMORY GSQL ENGINE';

  return (
    <header className="sticky top-0 z-40 border-b border-[#262A33] bg-[#0B0C0E]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        {/* Left: Brand Identity & Hardware Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 border border-[#262A33] bg-[#131519] px-3 py-1.5">
            <div className="flex h-6 w-6 items-center justify-center border border-[#D97736]/60 bg-[#D97736]/15 text-[#D97736]">
              <ShieldCheck className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold tracking-tight text-[#F3F1EC]">
                  VEILPAY
                </span>
                <span className="border border-[#D97736]/40 bg-[#261810] px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#E5A93C] uppercase">
                  ZERO-DOXX FIREWALL
                </span>
              </div>
              <p className="font-mono text-[10px] text-[#9499A3]">
                TIGERGRAPH × AIGI × SOCKET V3 × CAKE WALLET
              </p>
            </div>
          </div>

          {/* Real-time Telemetry Strip */}
          <div className="hidden items-center gap-2 lg:flex">
            <div className="flex items-center gap-2 border border-[#262A33] bg-[#131519] px-2.5 py-1.5 font-mono text-xs">
              <span className="h-2 w-2 rounded-full bg-[#1F9D68] animate-pulse" />
              <span className="text-[#9499A3]">ENGINE:</span>
              <span className="font-semibold text-[#F3F1EC]">{sourceLabel}</span>
            </div>

            <div className="flex items-center gap-2 border border-[#262A33] bg-[#131519] px-2.5 py-1.5 font-mono text-xs tabular-nums">
              <Activity className="h-3.5 w-3.5 text-[#E5A93C]" />
              <span className="text-[#9499A3]">TRAVERSAL:</span>
              <span className="font-semibold text-[#1F9D68]">
                {lastMeasuredLatencyMs.toFixed(2)} ms
              </span>
              <span className="text-[#646973]">
                ({linkConfig.policy.maxHops}-HOP)
              </span>
            </div>

            <div className="flex items-center gap-2 border border-[#262A33] bg-[#131519] px-2.5 py-1.5 font-mono text-xs tabular-nums">
              <ShieldAlert className="h-3.5 w-3.5 text-[#D6453A]" />
              <span className="text-[#9499A3]">INTERCEPTED:</span>
              <span className="font-semibold text-[#D6453A]">
                {totalThreatsIntercepted}
              </span>
            </div>
          </div>
        </div>

        {/* Right: View Switcher, Reown Wallet Connect & Settings */}
        <div className="flex items-center gap-2">
          <div className="hidden items-center border border-[#262A33] bg-[#131519] p-0.5 md:flex">
            <button
              type="button"
              onClick={() => setViewLayout('SPLIT')}
              className={`flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                viewLayout === 'SPLIT'
                  ? 'bg-[#D97736] text-[#0B0C0E] font-semibold'
                  : 'text-[#9499A3] hover:text-[#F3F1EC]'
              }`}
            >
              <Columns className="h-3 w-3" />
              SPLIT TERMINAL
            </button>
            <button
              type="button"
              onClick={() => setViewLayout('RECEIVER_ONLY')}
              className={`px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                viewLayout === 'RECEIVER_ONLY'
                  ? 'bg-[#D97736] text-[#0B0C0E] font-semibold'
                  : 'text-[#9499A3] hover:text-[#F3F1EC]'
              }`}
            >
              RECEIVER CONSOLE
            </button>
            <button
              type="button"
              onClick={() => setViewLayout('PAYER_ONLY')}
              className={`px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                viewLayout === 'PAYER_ONLY'
                  ? 'bg-[#D97736] text-[#0B0C0E] font-semibold'
                  : 'text-[#9499A3] hover:text-[#F3F1EC]'
              }`}
            >
              PAYER CHECKOUT
            </button>
          </div>

          <button
            type="button"
            onClick={() => open()}
            className="flex items-center gap-2 border border-[#D97736]/60 bg-[#261810] px-3 py-1.5 font-mono text-xs font-medium text-[#F3F1EC] transition-colors hover:border-[#E5A93C] hover:bg-[#D97736]/25"
          >
            <Wallet className="h-3.5 w-3.5 text-[#E5A93C]" />
            {isConnected && address ? (
              <span className="tabular-nums text-[#1F9D68]">
                {address.slice(0, 6)}...{address.slice(-4)}
              </span>
            ) : (
              <span>CONNECT WALLET (REOWN)</span>
            )}
            <ArrowUpRight className="h-3 w-3 text-[#9499A3]" />
          </button>

          <button
            type="button"
            onClick={() => setSettingsDrawerOpen(true)}
            className="flex items-center gap-1.5 border border-[#262A33] bg-[#131519] px-2.5 py-1.5 font-mono text-xs text-[#9499A3] transition-colors hover:border-[#363B47] hover:text-[#F3F1EC]"
            title="Configure Live Etherscan V2 Crawler & Mainnet Safety Cap"
          >
            <Sliders className="h-3.5 w-3.5 text-[#D97736]" />
            <span className="hidden sm:inline">ENGINE CONFIG</span>
          </button>
        </div>
      </div>
    </header>
  );
}
