'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Sliders,
  Shield,
  Database,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  CircleDashed,
} from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';
import type { HealthCheckResponse, IntegrationHealth } from '@/lib/health';

export function SettingsDrawer() {
  const {
    settingsDrawerOpen,
    setSettingsDrawerOpen,
    crawlSettings,
    updateCrawlSettings,
    runFirewallAndQuotePipeline,
  } = useVeilPayStore();

  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => {
    if (!settingsDrawerOpen) return;
    let cancelled = false;
    setHealthLoading(true);
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: HealthCheckResponse) => {
        if (!cancelled) {
          setHealthData(data);
          setHealthLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealthLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [settingsDrawerOpen]);

  if (!settingsDrawerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-md flex-col justify-between overflow-y-auto border-l border-[#262A33] bg-[#131519] p-5">
        <div className="space-y-5">
          <div className="flex items-center justify-between border-b border-[#262A33] pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-[#D97736]" />
              <span className="font-mono text-sm font-bold text-[#F3F1EC]">
                ENGINE &amp; SAFETY CONFIGURATION
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSettingsDrawerOpen(false)}
              className="border border-[#262A33] bg-[#1A1D23] p-1 text-[#9499A3] hover:text-[#F3F1EC]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 border border-[#262A33] bg-[#1A1D23] p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-[#E5A93C]" />
                <span className="font-mono text-xs font-semibold text-[#F3F1EC]">
                  ETHERSCAN V2 + GOPLUS LIVE CRAWLER
                </span>
              </div>
              <input
                type="checkbox"
                checked={crawlSettings.liveEtherscanCrawlEnabled}
                onChange={(e) =>
                  updateCrawlSettings({
                    liveEtherscanCrawlEnabled: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-[#D97736]"
              />
            </div>

            <p className="text-xs text-[#9499A3]">
              When scanning a custom address not in the seeded demo graph,
              crawls real N-hop inbound funding history via Etherscan API V2 +
              GoPlus Address Security API.
            </p>

            <div>
              <div className="mb-1 flex justify-between font-mono text-[11px]">
                <span className="text-[#9499A3]">TOP FUNDERS PER VERTEX:</span>
                <span className="font-bold tabular-nums text-[#E5A93C]">
                  {crawlSettings.topFundersPerVertex} funders
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={crawlSettings.topFundersPerVertex}
                onChange={(e) =>
                  updateCrawlSettings({
                    topFundersPerVertex: Number(e.target.value),
                  })
                }
                className="w-full accent-[#D97736]"
              />
            </div>

            <div>
              <div className="mb-1 flex justify-between font-mono text-[11px]">
                <span className="text-[#9499A3]">MAX API CALLS / SCAN:</span>
                <span className="font-bold tabular-nums text-[#E5A93C]">
                  {crawlSettings.maxApiCallsPerScan} calls
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={80}
                step={5}
                value={crawlSettings.maxApiCallsPerScan}
                onChange={(e) =>
                  updateCrawlSettings({
                    maxApiCallsPerScan: Number(e.target.value),
                  })
                }
                className="w-full accent-[#D97736]"
              />
            </div>
          </div>

          <div className="space-y-2.5 border border-[#262A33] bg-[#1A1D23] p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-[#1F9D68]" />
                <span className="font-mono text-xs font-semibold text-[#F3F1EC]">
                  MAINNET TRANSACTION SAFETY CAP
                </span>
              </div>
              <span className="font-mono text-xs font-bold tabular-nums text-[#1F9D68]">
                ${crawlSettings.maxMainnetUsdCap.toFixed(2)} USD
              </span>
            </div>
            <p className="text-xs text-[#9499A3]">
              Prevents accidental high-value mainnet signatures during live
              demos. Transactions exceeding this cap default to Safe Simulation
              Receipt mode unless explicitly overridden.
            </p>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={crawlSettings.maxMainnetUsdCap}
              onChange={(e) =>
                updateCrawlSettings({
                  maxMainnetUsdCap: Number(e.target.value),
                })
              }
              className="w-full accent-[#1F9D68]"
            />
          </div>

          <div className="space-y-2 border border-[#262A33] bg-[#1A1D23] p-3.5">
            <label className="flex cursor-pointer items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-[#D97736]" />
                <span className="font-mono text-xs font-semibold text-[#F3F1EC]">
                  PREFER LIVE TIGERGRAPH 4.x RESTPP
                </span>
              </div>
              <input
                type="checkbox"
                checked={crawlSettings.preferLiveTigerGraphRestpp}
                onChange={(e) =>
                  updateCrawlSettings({
                    preferLiveTigerGraphRestpp: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-[#D97736]"
              />
            </label>
            <p className="text-xs text-[#9499A3]">
              Attempts `/restpp/query/VeilPayGraph/veilpay_firewall_check` when
              TigerGraph credentials are configured, with zero-latency fallback
              to the in-process GSQL-mirror engine.
            </p>
          </div>

          <div className="space-y-2 border border-[#262A33] bg-[#0B0C0E] p-3.5">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[11px] font-semibold uppercase text-[#E5A93C]">
                INTEGRATION STACK DIAGNOSTICS
              </div>
              {healthLoading && (
                <span className="font-mono text-[10px] text-[#9499A3]">
                  CHECKING...
                </span>
              )}
            </div>

            {[
              {
                id: 'socket',
                name: 'SOCKET Swap V3 API',
                item: healthData?.integrations.socket,
              },
              {
                id: 'tigergraph',
                name: 'TigerGraph RESTPP & Engine',
                item: healthData?.integrations.tigergraph,
              },
              {
                id: 'etherscan',
                name: 'Etherscan V2 Multichain Crawler',
                item: healthData?.integrations.etherscan,
              },
              {
                id: 'goplus',
                name: 'GoPlus Security Intel',
                item: healthData?.integrations.goplus,
              },
              {
                id: 'gemini',
                name: 'Gemini AIGI Narration',
                item: healthData?.integrations.gemini,
              },
              {
                id: 'reown',
                name: 'Reown AppKit Connect',
                item: healthData?.integrations.reown,
              },
              {
                id: 'redis',
                name: 'Upstash Redis Events & Rate Limit',
                item: healthData?.integrations.redis,
              },
            ].map(({ id, name, item }) => {
              const status = item?.status ?? (healthLoading ? 'checking' : 'not_configured');
              return (
                <div
                  key={id}
                  className="flex flex-col gap-0.5 border-b border-[#262A33]/60 pb-1.5 font-mono text-[11px] last:border-none last:pb-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[#9499A3]">{name}</span>
                    {status === 'ok' ? (
                      <span className="flex items-center gap-1 text-[#1F9D68]">
                        <CheckCircle2 className="h-3 w-3" />
                        OK
                      </span>
                    ) : status === 'degraded' ? (
                      <span className="flex items-center gap-1 text-[#D99B26]">
                        <AlertTriangle className="h-3 w-3" />
                        DEGRADED
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[#9499A3]">
                        <CircleDashed className="h-3 w-3" />
                        NOT CONFIGURED
                      </span>
                    )}
                  </div>
                  {item?.message && (
                    <div className="text-[10px] text-[#9499A3]/80">
                      {item.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex gap-2 border-t border-[#262A33] pt-3">
          <button
            type="button"
            onClick={() => {
              setSettingsDrawerOpen(false);
              void runFirewallAndQuotePipeline();
            }}
            className="w-full border border-[#D97736] bg-[#D97736] py-2 font-mono text-xs font-bold text-[#0B0C0E] hover:bg-[#E5A93C]"
          >
            APPLY &amp; RE-RUN PRE-FLIGHT SCAN
          </button>
        </div>
      </div>
    </div>
  );
}
