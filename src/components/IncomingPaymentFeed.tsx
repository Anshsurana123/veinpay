'use client';

import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  Hash,
  ArrowUpRight,
  Activity,
} from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';

export function IncomingPaymentFeed() {
  const { paymentFeed, selectPersona } = useVeilPayStore();

  return (
    <div className="border border-[#262A33] bg-[#131519] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#262A33] pb-2.5">
        <div>
          <span className="font-mono text-xs font-semibold tracking-wider text-[#D97736] uppercase">
            REAL-TIME INCOMING PAYMENT &amp; FIREWALL INTERCEPT LOG
          </span>
          <p className="mt-0.5 text-xs text-[#9499A3]">
            Auditable log of pre-sign firewall blocks and verified cross-chain
            Cake Wallet settlements.
          </p>
        </div>
        <span className="border border-[#262A33] bg-[#1A1D23] px-2 py-0.5 font-mono text-[10px] tabular-nums text-[#E5A93C]">
          {paymentFeed.length} RECORDED EVENTS
        </span>
      </div>

      <div className="space-y-2.5">
        {paymentFeed.map((item) => {
          const isIntercepted = item.status === 'INTERCEPTED';
          return (
            <div
              key={item.id}
              className={`border p-3 transition-colors ${
                isIntercepted
                  ? 'border-[#D6453A]/50 bg-[#2D1412]/30'
                  : 'border-[#1F9D68]/50 bg-[#0E291E]/30'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isIntercepted ? (
                    <ShieldAlert className="h-4 w-4 text-[#D6453A]" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 text-[#1F9D68]" />
                  )}
                  <span
                    className={`border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                      isIntercepted
                        ? 'border-[#D6453A] bg-[#2D1412] text-[#D6453A]'
                        : 'border-[#1F9D68] bg-[#0E291E] text-[#1F9D68]'
                    }`}
                  >
                    {item.verdict}
                  </span>
                  <span className="font-mono text-xs font-bold tabular-nums text-[#F3F1EC]">
                    ${item.amountUsd} USD
                  </span>
                  <span className="font-mono text-[11px] text-[#9499A3]">
                    via {item.sourceChainName}
                  </span>
                </div>

                <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-[#9499A3]">
                  <Activity className="h-3 w-3 text-[#E5A93C]" />
                  <span>{item.latencyMs.toFixed(2)} ms</span>
                  <Clock className="ml-1 h-3 w-3 text-[#646973]" />
                  <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#262A33]/80 pt-2 font-mono text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-[#9499A3]">PAYER:</span>
                  <button
                    type="button"
                    onClick={() => selectPersona('CUSTOM', item.payerAddress)}
                    className="text-[#E5A93C] underline-offset-2 hover:underline"
                    title="Re-run firewall scan on this wallet"
                  >
                    {item.payerAddress.slice(0, 10)}...
                    {item.payerAddress.slice(-6)}
                  </button>
                  {item.hopDistance !== null && (
                    <span className="border border-[#D6453A]/50 bg-[#2D1412] px-1.5 py-0.5 text-[10px] text-[#D6453A]">
                      HOP {item.hopDistance} HIT
                    </span>
                  )}
                  {item.bridgeUsed && (
                    <span className="border border-[#1F9D68]/50 bg-[#0E291E] px-1.5 py-0.5 text-[10px] text-[#1F9D68]">
                      {item.bridgeUsed}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 text-[10px] text-[#646973]">
                  <Hash className="h-3 w-3" />
                  <span>SHA-256: {item.sha256Hash.slice(0, 16)}...</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
