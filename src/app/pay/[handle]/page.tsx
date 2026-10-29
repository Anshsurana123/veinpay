'use client';

import React, { useEffect, use, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useVeilPayStore } from '@/store/veilpay-store';
import { signedLinkPayloadToVeilPayConfig } from '@/lib/utils/link-codec';
import { TopTelemetryBar } from '@/components/TopTelemetryBar';
import { PayerCheckoutPanel } from '@/components/PayerCheckoutPanel';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import { CakeWalletSettlementModal } from '@/components/CakeWalletSettlementModal';
import type { LinkTrustLevel, SignedPaymentLinkPayload } from '@/types/veilpay';

function StandalonePayContent({ handle }: { handle: string }) {
  const searchParams = useSearchParams();
  const encodedPayload = searchParams.get('c');
  const signature = searchParams.get('sig');

  const {
    hydrateFromVerifiedLink,
    linkVerificationError,
    setLinkVerificationError,
  } = useVeilPayStore();

  const [verifying, setVerifying] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function verifyOnServer() {
      setVerifying(true);
      setLinkVerificationError(null);

      if (!encodedPayload || !signature) {
        if (!cancelled) {
          setLinkVerificationError(
            encodedPayload && !signature
              ? 'Legacy unsigned ?c= payment links are rejected. Payment links must include an EIP-712 receiver signature (?c=...&sig=0x...).'
              : 'Missing signed payment link parameters (?c=...&sig=0x...).'
          );
          setVerifying(false);
        }
        return;
      }

      try {
        const qs = new URLSearchParams({
          c: encodedPayload,
          sig: signature,
        });
        const res = await fetch(`/api/links?${qs.toString()}`);
        const data = (await res.json()) as {
          valid?: boolean;
          reason?: string;
          trustLevel?: LinkTrustLevel;
          payload?: SignedPaymentLinkPayload;
        };

        if (cancelled) return;

        if (!res.ok || !data.valid || !data.payload || !data.trustLevel) {
          setLinkVerificationError(
            data.reason || 'Payment link EIP-712 signature verification failed.'
          );
          setVerifying(false);
          return;
        }

        const decodedConfig = signedLinkPayloadToVeilPayConfig(data.payload);
        hydrateFromVerifiedLink(
          {
            payload: data.payload,
            c: encodedPayload,
            sig: signature as `0x${string}`,
            trustLevel: data.trustLevel,
          },
          decodedConfig
        );
        setVerifying(false);
      } catch (err) {
        if (!cancelled) {
          setLinkVerificationError(
            err instanceof Error
              ? err.message
              : 'Failed to verify signed payment link.'
          );
          setVerifying(false);
        }
      }
    }

    void verifyOnServer();
    return () => {
      cancelled = true;
    };
  }, [
    encodedPayload,
    signature,
    hydrateFromVerifiedLink,
    setLinkVerificationError,
  ]);

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

      {verifying ? (
        <div className="border border-[#262A33] bg-[#131519] p-6 font-mono text-xs text-[#9499A3]">
          VERIFYING EIP-712 RECEIVER SIGNATURE &amp; POLICY HASH ON SERVER...
        </div>
      ) : linkVerificationError ? (
        <div className="border border-[#D6453A] bg-[#2A1215] p-5 font-mono">
          <div className="flex items-center gap-2 text-xs font-bold text-[#D6453A] uppercase">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            PAYMENT LINK REJECTED // EIP-712 VERIFICATION FAILED
          </div>
          <p className="mt-2 text-xs text-[#F3F1EC]">{linkVerificationError}</p>
          <p className="mt-2 text-[11px] text-[#9499A3]">
            VeilPay requires a cryptographically signed EIP-712 PaymentLink
            payload (?c=...&amp;sig=0x...) that has not been tampered with,
            expired, or revoked.
          </p>
        </div>
      ) : (
        <PayerCheckoutPanel />
      )}
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
            DECODING &amp; VERIFYING EIP-712 VEILPAY LINK...
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
