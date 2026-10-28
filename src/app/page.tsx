'use client';

import React from 'react';
import {
  Link2,
  ShieldAlert,
  Activity,
  Terminal,
  ArrowRight,
} from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { TopTelemetryBar } from '@/components/TopTelemetryBar';
import { ReceiverSetupForm } from '@/components/ReceiverSetupForm';
import { SafeSendOutboundGuard } from '@/components/SafeSendOutboundGuard';
import { IncomingPaymentFeed } from '@/components/IncomingPaymentFeed';
import { PayerCheckoutPanel } from '@/components/PayerCheckoutPanel';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import { CakeWalletSettlementModal } from '@/components/CakeWalletSettlementModal';

export default function HomePage() {
  const {
    activeLeftTab,
    setActiveLeftTab,
    viewLayout,
    paymentFeed,
  } = useVeilPayStore();

  return (
    <div className="min-h-screen bg-[#0B0C0E] text-[#F3F1EC] flex flex-col">
      {/* Top Hardware Telemetry Bar */}
      <TopTelemetryBar />

      {/* Main Split-Screen Command Center */}
      <main className="mx-auto w-full max-w-[1640px] flex-1 px-4 py-4">
        <div
          className={`grid gap-4 ${
            viewLayout === 'SPLIT'
              ? 'grid-cols-1 xl:grid-cols-12'
              : 'grid-cols-1'
          }`}
        >
          {/* LEFT PANEL: Receiver Command Center */}
          {(viewLayout === 'SPLIT' || viewLayout === 'RECEIVER_ONLY') && (
            <section
              className={
                viewLayout === 'SPLIT' ? 'xl:col-span-5' : 'mx-auto w-full max-w-4xl'
              }
            >
              {/* Receiver Sub-Navigation Tabs */}
              <div className="mb-3 grid grid-cols-3 gap-1 border border-[#262A33] bg-[#131519] p-1">
                <button
                  type="button"
                  onClick={() => setActiveLeftTab('LINK_BUILDER')}
                  className={`flex items-center justify-center gap-1.5 py-2 font-mono text-[11px] font-semibold transition-colors ${
                    activeLeftTab === 'LINK_BUILDER'
                      ? 'bg-[#D97736] text-[#0B0C0E] font-bold'
                      : 'text-[#9499A3] hover:text-[#F3F1EC]'
                  }`}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>LINK &amp; FIREWALL</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveLeftTab('SAFE_SEND')}
                  className={`flex items-center justify-center gap-1.5 py-2 font-mono text-[11px] font-semibold transition-colors ${
                    activeLeftTab === 'SAFE_SEND'
                      ? 'bg-[#D97736] text-[#0B0C0E] font-bold'
                      : 'text-[#9499A3] hover:text-[#F3F1EC]'
                  }`}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>SAFE SEND GUARD</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveLeftTab('INCOMING_FEED')}
                  className={`flex items-center justify-center gap-1.5 py-2 font-mono text-[11px] font-semibold transition-colors ${
                    activeLeftTab === 'INCOMING_FEED'
                      ? 'bg-[#D97736] text-[#0B0C0E] font-bold'
                      : 'text-[#9499A3] hover:text-[#F3F1EC]'
                  }`}
                >
                  <Activity className="h-3.5 w-3.5" />
                  <span>FEED ({paymentFeed.length})</span>
                </button>
              </div>

              {/* Active Receiver Module */}
              {activeLeftTab === 'LINK_BUILDER' && <ReceiverSetupForm />}
              {activeLeftTab === 'SAFE_SEND' && <SafeSendOutboundGuard />}
              {activeLeftTab === 'INCOMING_FEED' && <IncomingPaymentFeed />}
            </section>
          )}

          {/* RIGHT PANEL: Live Payer Checkout & Pre-Sign Graph Firewall */}
          {(viewLayout === 'SPLIT' || viewLayout === 'PAYER_ONLY') && (
            <section
              className={
                viewLayout === 'SPLIT' ? 'xl:col-span-7' : 'mx-auto w-full max-w-5xl'
              }
            >
              <PayerCheckoutPanel />
            </section>
          )}
        </div>
      </main>

      {/* Footer Status Strip */}
      <footer className="mt-8 border-t border-[#262A33] bg-[#131519] py-3">
        <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-2 px-4 font-mono text-[11px] text-[#9499A3]">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-[#D97736]" />
            <span>
              VEILPAY v1.0 // HACKER HOUSE GOA · TIGERGRAPH × AIGI × SOCKET V3 ×
              CAKE WALLET
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[#1F9D68]">
              ● ZERO-DOXX PRE-SIGN FIREWALL ACTIVE
            </span>
            <span>GSQL ARTIFACT: /tigergraph/veilpay_firewall.gsql</span>
          </div>
        </div>
      </footer>

      {/* Modals & Drawers */}
      <SettingsDrawer />
      <CakeWalletSettlementModal />
    </div>
  );
}
