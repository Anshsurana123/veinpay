'use client';

import React from 'react';
import { useVeilPayStore } from '@/store/veilpay-store';

export function TopNav() {
  const { activeTab, setActiveTab, paymentFeed } = useVeilPayStore();

  const tabs: Array<{ id: 'pay' | 'create' | 'activity' | 'safesend'; label: string }> = [
    { id: 'pay', label: 'Pay' },
    { id: 'create', label: 'Create link' },
    {
      id: 'activity',
      label: paymentFeed.length > 0 ? `Activity (${paymentFeed.length})` : 'Activity',
    },
    { id: 'safesend', label: 'Safe send' },
  ];

  return (
    <nav
      role="tablist"
      aria-label="Primary Navigation"
      className="flex bg-[#16252f] border border-[#27404f] rounded-xl p-1 mb-3.5 gap-0.5"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 border-0 py-2.5 px-2 rounded-lg text-sm cursor-pointer font-medium transition-colors text-center ${
              isActive
                ? 'bg-[#1c2f3b] text-[#eaf0f3]'
                : 'text-[#8ea5b4] hover:text-[#eaf0f3]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
