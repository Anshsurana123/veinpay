'use client';

import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  Hash,
  Activity,
} from 'lucide-react';
import { useVeinPayStore } from '@/store/veinpay-store';

export function IncomingPaymentFeed() {
  const { paymentFeed, selectPersona } = useVeinPayStore();

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
        {paymentFeed.length === 0 ? (
          <div className="border border-[#262A33] bg-[#0B0C0E] p-6 text-center font-mono text-xs text-[#9499A3]">
            No activity events recorded yet. Connect a wallet, execute a scan, or broadcast a settlement to log verified events.
          </div>
        ) : (
          paymentFeed.map((item) => {
            const isIntercepted =
              item.status === 'INTERCEPTED' ||
              item.status === 'BLOCKED' ||
              item.status === 'FAILED';
            const isPendingOrUnverified =
              item.status === 'PENDING' ||
              item.status === 'AWAITING_PAYMENT' ||
              item.status === 'CLAIMED_UNVERIFIED';

            return (
              <div
                key={item.id}
                className={`border p-3 transition-colors ${
                  isIntercepted
                    ? 'border-[#D6453A]/50 bg-[#2D1412]/30'
                    : isPendingOrUnverified
                      ? 'border-[#D99B26]/50 bg-[#2B210D]/30'
                      : 'border-[#1F9D68]/50 bg-[#0E291E]/30'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {isIntercepted ? (
                      <ShieldAlert className="h-4 w-4 text-[#D6453A]" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 text-[#1F9D68]" />
                    )}
                    <span
                      className={`border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                        isIntercepted
                          ? 'border-[#D6453A] bg-[#2D1412] text-[#D6453A]'
                          : isPendingOrUnverified
                            ? 'border-[#D99B26] bg-[#2B210D] text-[#D99B26]'
                            : 'border-[#1F9D68] bg-[#0E291E] text-[#1F9D68]'
                      }`}
                    >
                      {item.status} ({item.verdict})
                    </span>
                    {item.simulated && (
                      <span className="border border-[#D99B26]/50 bg-[#2B210D] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#E5A93C]">
                        SIMULATED
                      </span>
                    )}
                    <span className="font-mono text-xs font-bold tabular-nums text-[#F3F1EC]">
                      ${item.amount} USD ({item.asset})
                    </span>
                    <span className="font-mono text-[11px] text-[#9499A3]">
                      via {item.sourceChainName}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-[#9499A3]">
                    <Activity className="h-3 w-3 text-[#E5A93C]" />
                    <span>{item.latencyMs.toFixed(2)} ms</span>
                    <Clock className="ml-1 h-3 w-3 text-[#646973]" />
                    <span>{item.timestamp.slice(11, 19)} UTC</span>
                  </div>
                </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#262A33]/80 pt-2 font-mono text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-[#9499A3]">PAYER:</span>
                  <button
                    type="button"
                    onClick={() => selectPersona('custom', item.payerAddress)}
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
        }))}
      </div>
    </div>
  );
}
