'use client';

import React from 'react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { AppHeader } from '@/components/AppHeader';
import { JudgeStrip } from '@/components/JudgeStrip';
import { TopNav } from '@/components/TopNav';
import { PayCheckout } from '@/components/PayCheckout';
import { LinkBuilder } from '@/components/LinkBuilder';
import { ActivityFeed } from '@/components/ActivityFeed';
import { SafeSend } from '@/components/SafeSend';
import { SettlementSheet } from '@/components/SettlementSheet';
import { SettingsDrawer } from '@/components/SettingsDrawer';

export default function HomePage() {
  const { activeTab } = useVeilPayStore();

  return (
    <div className="w-full max-w-[600px] mx-auto min-h-screen px-3.5 py-4 pb-20">
      {/* Universal Header */}
      <AppHeader />

      {/* Judge View Engine & Latency Telemetry */}
      <JudgeStrip />

      {/* Top 4-Tab Navigation */}
      <TopNav />

      {/* Active Tab Screen */}
      <main>
        {activeTab === 'pay' && <PayCheckout />}
        {activeTab === 'create' && <LinkBuilder />}
        {activeTab === 'activity' && <ActivityFeed />}
        {activeTab === 'safesend' && <SafeSend />}
      </main>

      {/* Calm Institutional Footer */}
      <footer className="text-center text-[#8ea5b4] text-xs mt-8">
        Screened by TigerGraph · Verified by AIGI · Routed by Socket · Paid to Cake Wallet
      </footer>

      {/* Modals & Slide-up Drawers */}
      <SettlementSheet />
      <SettingsDrawer />
    </div>
  );
}
