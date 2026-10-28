'use client';

import React, { useEffect, use, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { decodePaymentLinkPayload } from '@/lib/utils/link-codec';
import { TopTelemetryBar } from '@/components/TopTelemetryBar';
import { PayerCheckoutPanel } from '@/components/PayerCheckoutPanel';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import { CakeWalletSettlementModal } from '@/components/CakeWalletSettlementModal';

function StandalonePayContent({ handle }: { handle: string }) {
  const searchParams = useSearchParams();
  const encodedPayload = searchParams.get('c');

  const { hydrateFromDecodedLink, updateLinkConfig } = useVeilPayStore();

  useEffect(() => {
    if (encodedPayload) {
      const decoded = decodePaymentLinkPayload(encodedPayload);
      if (decoded) {
        hydrateFromDecodedLink(decoded);
        return;
      }
    }
    if (handle) {
      updateLinkConfig({ handle: decodeURIComponent(handle) });
    }
  }, [encodedPayload, handle, hydrateFromDecodedLink, updateLinkConfig]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-[#262A33] bg-[#131519] px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-xs">
          <ShieldCheck className="h-4 w-4 text-[#1F9D68]" />
          <span className="font-bold text-[#F3F1EC]">
            STANDALONE PAYER CHECKOUT // veilpay.xyz/pay/
            {decodeURIComponent(handle)}
          </span>
        </div>

        <Link
          href="/"
          className="flex items-center gap-1.5 border border-[#D97736] bg-[#261810] px-3 py-1 font-mono text-xs font-semibold text-[#E5A93C] hover:bg-[#D97736] hover:text-[#0B0C0E]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          OPEN RECEIVER + PAYER SPLIT CONSOLE
        </Link>
      </div>

      <PayerCheckoutPanel />
    </main>
  );
}

export default function StandalonePayRoute({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const resolvedParams = use(params);

  return (
    <div className="min-h-screen bg-[#0B0C0E] text-[#F3F1EC] flex flex-col">
      <TopTelemetryBar />

      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-5xl p-8 font-mono text-xs text-[#9499A3]">
            DECODING STATELESS VEILPAY LINK CONFIGURATION...
          </div>
        }
      >
        <StandalonePayContent handle={resolvedParams.handle} />
      </Suspense>

      <SettingsDrawer />
      <CakeWalletSettlementModal />
    </div>
  );
}
