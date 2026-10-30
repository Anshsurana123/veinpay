'use client';

import React from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { useVeilPayStore } from '@/store/veilpay-store';

export function AppHeader() {
  const {
    networkEnv,
    setNetworkEnv,
    judgeMode,
    toggleJudgeMode,
    setSettingsDrawerOpen,
    syncConnectedWallet,
    selectPersona,
    activePersonaId,
  } = useVeilPayStore();

  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { open } = useAppKit();

  const prevConnectedAddressRef = React.useRef<string | null>(null);
  const initialSyncRef = React.useRef(false);

  React.useEffect(() => {
    const current = isConnected && address ? address : null;
    const prev = prevConnectedAddressRef.current;
    prevConnectedAddressRef.current = current;

    syncConnectedWallet(current);

    if (!initialSyncRef.current) {
      initialSyncRef.current = true;
      if (current) {
        selectPersona('reown-connected', current);
        return;
      }
    }

    if (!prev && current) {
      selectPersona('reown-connected', current);
      return;
    }

    if (prev && current && prev.toLowerCase() !== current.toLowerCase()) {
      selectPersona('reown-connected', current);
      return;
    }

    if (prev && !current && activePersonaId === 'reown-connected') {
      selectPersona('persona-1');
    }
  }, [isConnected, address, activePersonaId, selectPersona, syncConnectedWallet]);

  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null;

  return (
    <header className="flex items-center gap-2 flex-wrap mb-4">
      {/* Brand Logo */}
      <div className="font-serif font-semibold text-[21px] flex items-center gap-2.5 mr-auto text-[#eaf0f3]">
        <i
          className="w-6 h-6 rounded-full inline-block flex-shrink-0"
          style={{
            background: 'conic-gradient(from 200deg, #efe6d2, #6d8fa3, #efe6d2)',
          }}
          aria-hidden="true"
        />
        <span>VeilPay</span>
      </div>

      {/* Mainnet / Testnet Switch */}
      <div
        role="group"
        aria-label="Network Environment"
        className="flex border border-[#27404f] rounded-full p-[3px] bg-[#16252f]"
      >
        <button
          type="button"
          onClick={() => setNetworkEnv('MAINNET')}
          className={`border-0 rounded-full py-1 px-3 text-[13px] cursor-pointer font-medium transition-colors ${
            networkEnv === 'MAINNET'
              ? 'bg-[#1c2f3b] text-[#eaf0f3]'
              : 'text-[#8ea5b4] hover:text-[#eaf0f3]'
          }`}
        >
          Mainnet
        </button>
        <button
          type="button"
          onClick={() => setNetworkEnv('TESTNET')}
          className={`border-0 rounded-full py-1 px-3 text-[13px] cursor-pointer font-medium transition-colors ${
            networkEnv === 'TESTNET'
              ? 'bg-[#1c2f3b] text-[#e8c06a]'
              : 'text-[#8ea5b4] hover:text-[#eaf0f3]'
          }`}
        >
          Testnet
        </button>
      </div>

      {/* Connect Wallet / Connected Short Address */}
      {isConnected && shortAddress ? (
        <button
          type="button"
          onClick={() => open({ view: 'Account' }).catch(() => disconnect())}
          className="border border-[#7fd6b0] text-[#7fd6b0] rounded-full py-1.5 px-3 text-[13px] font-medium whitespace-nowrap cursor-pointer hover:bg-[#16252f] transition-colors"
          title="Connected wallet. Click to open account or disconnect."
        >
          {shortAddress} ✓
        </button>
      ) : (
        <button
          type="button"
          onClick={() => open()}
          className="border border-[#efe6d2] bg-[#efe6d2] text-[#14212a] rounded-full py-1.5 px-3.5 text-[13px] font-semibold whitespace-nowrap cursor-pointer hover:opacity-90 transition-opacity"
        >
          Connect wallet
        </button>
      )}

      {/* Judge View Toggle */}
      <button
        type="button"
        onClick={toggleJudgeMode}
        title="Toggle engine telemetry and fixtures"
        className={`border rounded-full py-1.5 px-3 text-[13px] whitespace-nowrap cursor-pointer transition-colors ${
          judgeMode
            ? 'border-[#efe6d2] text-[#efe6d2] bg-[#1c2f3b]'
            : 'border-[#27404f] text-[#8ea5b4] hover:text-[#eaf0f3]'
        }`}
      >
        Judge view
      </button>

      {/* Settings Drawer Button */}
      <button
        type="button"
        onClick={() => setSettingsDrawerOpen(true)}
        className="border border-[#27404f] text-[#8ea5b4] hover:text-[#eaf0f3] rounded-full py-1.5 px-3 text-[13px] whitespace-nowrap cursor-pointer transition-colors"
      >
        Settings
      </button>
    </header>
  );
}
