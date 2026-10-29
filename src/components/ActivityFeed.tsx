'use client';

import React, { useEffect, useState } from 'react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { useCctpTransfer } from '@/hooks/useCctpTransfer';

export function ActivityFeed() {
  const {
    paymentFeed,
    selectPersona,
    setActiveTab,
    runFirewallAndQuotePipeline,
    fetchEvents,
    linkConfig,
  } = useVeilPayStore();

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const {
    resumableTransfers,
    completeMintOnDestination,
    isBusy: isCctpBusy,
  } = useCctpTransfer({
    linkId: linkConfig.handle,
    receiverVaultAddress: linkConfig.vaultAddresses.EVM_SOCKET,
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const handleRescanPayer = (address: string) => {
    selectPersona('custom', address);
    setActiveTab('pay');
    void runFirewallAndQuotePipeline();
    showToast(`Re-scanning ${address.slice(0, 6)}…${address.slice(-4)}`);
  };

  return (
    <section aria-label="Activity and Payments Feed" className="space-y-4">
      <div>
        <h1 className="font-serif text-[30px] leading-tight text-[#eaf0f3] mb-1 font-normal">
          Payments
        </h1>
        <p className="text-sm text-[#8ea5b4]">
          Every block and settlement, with a receipt hash you can audit.
        </p>
      </div>

      {/* Resumable CCTP Transfers Section (if any pending burns need minting) */}
      {resumableTransfers.length > 0 && (
        <div className="bg-[#16252f] border border-[#e8c06a]/40 rounded-2xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-[#e8c06a]">
              Pending CCTP Transfers ({resumableTransfers.length})
            </span>
            <span className="text-[11px] text-[#8ea5b4]">
              Burn completed · Ready for mint
            </span>
          </div>

          {resumableTransfers.map((tx) => (
            <div
              key={tx.burnTxHash}
              className="bg-[#0f1a21] border border-[#27404f] rounded-xl p-3 flex justify-between items-center gap-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <span className="font-mono text-[#eaf0f3] block truncate">
                  Burn Tx: {tx.burnTxHash.slice(0, 10)}…{tx.burnTxHash.slice(-6)}
                </span>
                <span className="text-[#8ea5b4] text-[11px]">
                  Domain {tx.sourceDomain} → {tx.destinationDomain} · Amount:{' '}
                  {tx.amountInAtomic}
                </span>
              </div>
              <button
                type="button"
                disabled={isCctpBusy}
                onClick={() => void completeMintOnDestination(tx)}
                className="py-1.5 px-3 rounded-lg text-xs font-semibold bg-[#efe6d2] text-[#14212a] cursor-pointer hover:opacity-90 disabled:opacity-50"
              >
                {isCctpBusy ? 'Minting…' : 'Resume & Mint'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Payment Feed Card */}
      <div className="bg-[#16252f] border border-[#27404f] rounded-[20px] p-5">
        {paymentFeed.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#8ea5b4]">
            No payments yet. Share your link to get started.
          </div>
        ) : (
          <div className="divide-y divide-[#27404f]">
            {paymentFeed.map((item) => {
              const isSettled =
                item.status === 'SETTLED' || item.status === 'CONFIRMED';
              const isBlocked =
                item.status === 'BLOCKED' ||
                item.status === 'INTERCEPTED' ||
                item.status === 'FAILED';

              const tagColor = isSettled
                ? 'text-[#7fd6b0] border-[#7fd6b0]/40'
                : isBlocked
                ? 'text-[#f28b7b] border-[#f28b7b]/40'
                : 'text-[#e8c06a] border-[#e8c06a]/40';

              const statusText = isSettled
                ? 'Settled'
                : isBlocked
                ? 'Blocked'
                : item.status === 'CLAIMED_UNVERIFIED'
                ? 'Claimed'
                : 'Pending';

              return (
                <div
                  key={item.id}
                  onClick={() => handleRescanPayer(item.payerAddress)}
                  className="py-3.5 first:pt-0 last:pb-0 flex items-start gap-3 cursor-pointer hover:bg-[#1c2f3b]/30 rounded-xl px-2.5 -mx-2.5 transition-colors"
                >
                  <span
                    className={`text-[11.5px] border rounded-full px-2.5 py-0.5 font-medium shrink-0 mt-0.5 ${tagColor}`}
                  >
                    {statusText}
                  </span>
                  <div className="flex-1 min-w-0">
                    <b className="font-medium text-[14.5px] text-[#eaf0f3] block truncate">
                      ${Number(item.amount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}{' '}
                      {item.asset} from {item.payerAddress.slice(0, 6)}…
                      {item.payerAddress.slice(-4)}
                      {item.simulated && (
                        <span className="text-xs text-[#e8c06a] font-normal ml-2">
                          (Simulated)
                        </span>
                      )}
                    </b>
                    <small className="text-[#8ea5b4] text-xs block mt-0.5">
                      {item.verdict}
                      {item.hopDistance !== null
                        ? ` · found at hop ${item.hopDistance}`
                        : ''}{' '}
                      · {item.latencyMs.toFixed(1)} ms · {item.bridgeUsed || '—'}
                    </small>
                    <small className="font-mono text-[11px] text-[#8ea5b4] block mt-0.5 truncate">
                      {item.sha256Hash}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 bg-[#efe6d2] text-[#14212a] py-2 px-4 rounded-full font-semibold z-50 text-sm shadow-xl">
          {toastMessage}
        </div>
      )}
    </section>
  );
}
