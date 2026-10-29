'use client';

import React, { useEffect, useState } from 'react';
import { useVeilPayStore } from '@/store/veilpay-store';
import type { HealthCheckResponse } from '@/lib/health';

export function SettingsDrawer() {
  const {
    settingsDrawerOpen,
    setSettingsDrawerOpen,
    crawlSettings,
    updateCrawlSettings,
    runFirewallAndQuotePipeline,
  } = useVeilPayStore();

  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);

  useEffect(() => {
    if (!settingsDrawerOpen) return;
    let cancelled = false;
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: HealthCheckResponse) => {
        if (!cancelled) setHealthData(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [settingsDrawerOpen]);

  if (!settingsDrawerOpen) return null;

  const handleApply = () => {
    setSettingsDrawerOpen(false);
    void runFirewallAndQuotePipeline();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 bg-[#050a0e]/80 flex justify-end z-50 p-0 backdrop-blur-sm"
    >
      <div className="w-full max-w-[420px] bg-[#16252f] border-l border-[#27404f] h-full overflow-y-auto p-5 flex flex-col justify-between shadow-2xl">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-serif text-[22px] text-[#eaf0f3] font-normal">
              Settings
            </h3>
            <button
              type="button"
              onClick={() => setSettingsDrawerOpen(false)}
              className="border border-[#27404f] rounded-full py-1 px-3 text-xs text-[#8ea5b4] hover:text-[#eaf0f3] cursor-pointer transition-colors"
            >
              Close
            </button>
          </div>

          {/* Toggle 1: Live Etherscan Crawl */}
          <div className="flex justify-between items-center gap-3 py-2.5 border-t border-[#27404f]">
            <div>
              <span className="text-sm font-medium text-[#eaf0f3]">
                Check unknown wallets live
              </span>
              <p className="text-xs text-[#8ea5b4] m-0">
                Uses Etherscan and GoPlus when a wallet isn’t in the demo graph.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                updateCrawlSettings({
                  liveEtherscanCrawlEnabled:
                    !crawlSettings.liveEtherscanCrawlEnabled,
                })
              }
              className={`w-9 h-5 rounded-full relative cursor-pointer border-0 shrink-0 transition-colors ${
                crawlSettings.liveEtherscanCrawlEnabled
                  ? 'bg-[#7fd6b0]'
                  : 'bg-[#27404f]'
              }`}
            >
              <span
                className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${
                  crawlSettings.liveEtherscanCrawlEnabled
                    ? 'left-[19px] bg-[#14212a]'
                    : 'left-[3px] bg-[#eaf0f3]'
                }`}
              />
            </button>
          </div>

          {/* Toggle 2: Prefer Live TigerGraph */}
          <div className="flex justify-between items-center gap-3 py-2.5 border-t border-[#27404f]">
            <span className="text-sm font-medium text-[#eaf0f3]">
              Use live TigerGraph when available
            </span>
            <button
              type="button"
              onClick={() =>
                updateCrawlSettings({
                  preferLiveTigerGraphRestpp:
                    !crawlSettings.preferLiveTigerGraphRestpp,
                })
              }
              className={`w-9 h-5 rounded-full relative cursor-pointer border-0 shrink-0 transition-colors ${
                crawlSettings.preferLiveTigerGraphRestpp
                  ? 'bg-[#7fd6b0]'
                  : 'bg-[#27404f]'
              }`}
            >
              <span
                className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${
                  crawlSettings.preferLiveTigerGraphRestpp
                    ? 'left-[19px] bg-[#14212a]'
                    : 'left-[3px] bg-[#eaf0f3]'
                }`}
              />
            </button>
          </div>

          {/* Numeric 1: Top Funders per Vertex */}
          <div className="flex justify-between items-center gap-3 py-2.5 border-t border-[#27404f]">
            <span className="text-sm text-[#eaf0f3]">
              Funders traced per wallet
            </span>
            <input
              type="number"
              min={1}
              max={20}
              value={crawlSettings.topFundersPerVertex}
              onChange={(e) =>
                updateCrawlSettings({
                  topFundersPerVertex: Math.max(1, Number(e.target.value) || 5),
                })
              }
              className="w-20 bg-[#0f1a21] border border-[#27404f] rounded-xl px-2.5 py-1.5 text-sm text-center text-[#eaf0f3] outline-none focus:border-[#efe6d2]"
            />
          </div>

          {/* Numeric 2: Max API Calls per Scan */}
          <div className="flex justify-between items-center gap-3 py-2.5 border-t border-[#27404f]">
            <span className="text-sm text-[#eaf0f3]">
              Max API calls per scan
            </span>
            <input
              type="number"
              min={5}
              max={100}
              value={crawlSettings.maxApiCallsPerScan}
              onChange={(e) =>
                updateCrawlSettings({
                  maxApiCallsPerScan: Math.max(5, Number(e.target.value) || 40),
                })
              }
              className="w-20 bg-[#0f1a21] border border-[#27404f] rounded-xl px-2.5 py-1.5 text-sm text-center text-[#eaf0f3] outline-none focus:border-[#efe6d2]"
            />
          </div>

          {/* Numeric 3: Live Payment USD Cap */}
          <div className="flex justify-between items-center gap-3 py-2.5 border-t border-[#27404f]">
            <div>
              <span className="text-sm text-[#eaf0f3]">
                Live payment cap (USD)
              </span>
              <p className="text-xs text-[#8ea5b4] m-0">
                Stops accidental large mainnet sends.
              </p>
            </div>
            <input
              type="number"
              step="1"
              min={1}
              value={crawlSettings.maxMainnetUsdCap}
              onChange={(e) =>
                updateCrawlSettings({
                  maxMainnetUsdCap: Math.max(1, Number(e.target.value) || 5),
                })
              }
              className="w-20 bg-[#0f1a21] border border-[#27404f] rounded-xl px-2.5 py-1.5 text-sm text-center text-[#eaf0f3] outline-none focus:border-[#efe6d2]"
            />
          </div>

          {/* Connected Services Telemetry */}
          <div className="pt-2">
            <div className="text-xs text-[#8ea5b4] mb-2 font-medium">
              Connected services
            </div>

            <div className="divide-y divide-[#27404f]">
              <div className="flex justify-between items-center py-2 text-xs">
                <span className="text-[#eaf0f3]">Socket V3 routing</span>
                <span
                  className={`text-[11.5px] border rounded-full px-2 py-0.5 ${
                    healthData?.integrations.socket.status === 'ok'
                      ? 'text-[#7fd6b0] border-[#7fd6b0]/40'
                      : 'text-[#e8c06a] border-[#e8c06a]/40'
                  }`}
                >
                  {healthData?.integrations.socket.status === 'ok'
                    ? 'Live'
                    : 'Degraded'}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 text-xs">
                <span className="text-[#eaf0f3]">TigerGraph</span>
                <span
                  className={`text-[11.5px] border rounded-full px-2 py-0.5 ${
                    healthData?.integrations.tigergraph.configured
                      ? 'text-[#7fd6b0] border-[#7fd6b0]/40'
                      : 'text-[#7fd6b0] border-[#7fd6b0]/40'
                  }`}
                >
                  {healthData?.integrations.tigergraph.configured
                    ? 'RESTPP Live'
                    : 'In-memory'}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 text-xs">
                <span className="text-[#eaf0f3]">Etherscan + GoPlus</span>
                <span
                  className={`text-[11.5px] border rounded-full px-2 py-0.5 ${
                    healthData?.integrations.etherscan.configured
                      ? 'text-[#7fd6b0] border-[#7fd6b0]/40'
                      : 'text-[#e8c06a] border-[#e8c06a]/40'
                  }`}
                >
                  {healthData?.integrations.etherscan.configured
                    ? 'Live'
                    : 'Key needed'}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 text-xs">
                <span className="text-[#eaf0f3]">Gemini summaries</span>
                <span
                  className={`text-[11.5px] border rounded-full px-2 py-0.5 ${
                    healthData?.integrations.gemini.configured
                      ? 'text-[#7fd6b0] border-[#7fd6b0]/40'
                      : 'text-[#8ea5b4] border-[#27404f]'
                  }`}
                >
                  {healthData?.integrations.gemini.configured
                    ? 'Active'
                    : 'Optional'}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 text-xs">
                <span className="text-[#eaf0f3]">Reown wallet connect</span>
                <span className="text-[11.5px] border rounded-full px-2 py-0.5 text-[#7fd6b0] border-[#7fd6b0]/40">
                  {healthData?.integrations.reown.configured ? 'Ready' : 'Ready'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Apply Button */}
        <button
          type="button"
          onClick={handleApply}
          className="w-full py-3.5 rounded-xl text-sm font-semibold bg-[#efe6d2] text-[#14212a] hover:opacity-95 cursor-pointer mt-4"
        >
          Apply and re-scan
        </button>
      </div>
    </div>
  );
}
