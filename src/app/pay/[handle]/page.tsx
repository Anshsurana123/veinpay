'use client';

import React, { useEffect, use, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useVeinPayStore } from '@/store/veinpay-store';
import { signedLinkPayloadToVeinPayConfig } from '@/lib/utils/link-codec';
import { AppHeader } from '@/components/AppHeader';
import { JudgeStrip } from '@/components/JudgeStrip';
import { PayCheckout } from '@/components/PayCheckout';
import { SettlementSheet } from '@/components/SettlementSheet';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import type { LinkTrustLevel, SignedPaymentLinkPayload } from '@/types/veinpay';

function StandalonePayContent({ handle }: { handle: string }) {
  const searchParams = useSearchParams();
  const encodedPayload = searchParams.get('c');
  const signature = searchParams.get('sig');

  const {
    hydrateFromVerifiedLink,
    linkVerificationError,
    setLinkVerificationError,
  } = useVeinPayStore();

  const [verifying, setVerifying] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function verifyOnServer() {
      setVerifying(true);
      setLinkVerificationError(null);

      // Support short links /pay/[handle] via server lookup, with ?c=&sig= as stateless fallback
      if (!encodedPayload || !signature) {
        try {
          const res = await fetch(`/api/links?handle=${encodeURIComponent(handle)}`);
          const data = (await res.json()) as {
            valid?: boolean;
            reason?: string;
            trustLevel?: LinkTrustLevel;
            payload?: SignedPaymentLinkPayload;
            c?: string;
            sig?: `0x${string}`;
          };

          if (cancelled) return;

          if (res.ok && data.valid && data.payload && data.c && data.sig && data.trustLevel) {
            const decodedConfig = signedLinkPayloadToVeinPayConfig(data.payload);
            hydrateFromVerifiedLink(
              {
                payload: data.payload,
                c: data.c,
                sig: data.sig,
                trustLevel: data.trustLevel,
              },
              decodedConfig
            );
            setVerifying(false);
            return;
          }
        } catch {
          // Fall through to error
        }

        if (!cancelled) {
          setLinkVerificationError(
            encodedPayload && !signature
              ? 'Legacy unsigned payment links are rejected. Payment links must include an EIP-712 receiver signature (?c=…&sig=0x…).'
              : `No active verified payment link found for handle "${handle}". Check the handle or use a full link with ?c=…&sig=0x…`
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

        const decodedConfig = signedLinkPayloadToVeinPayConfig(data.payload);
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
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 text-xs text-[#8ea5b4]">
        <span>
          Checkout for <b className="text-[#eaf0f3]">{decodeURIComponent(handle)}</b>
        </span>
        <Link
          href="/"
          className="text-[#efe6d2] hover:underline"
        >
          Open VeinPay console ↗
        </Link>
      </div>

      {verifying ? (
        <div className="bg-[#16252f] border border-[#27404f] rounded-2xl p-8 text-center text-sm text-[#8ea5b4]">
          Verifying EIP-712 receiver signature and firewall rules…
        </div>
      ) : linkVerificationError ? (
        <div className="bg-[#f28b7b]/[0.09] border border-[#f28b7b]/40 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#f28b7b]">
            Payment link rejected
          </div>
          <p className="mt-1 text-xs text-[#eaf0f3] leading-relaxed">
            {linkVerificationError}
          </p>
          <p className="mt-2 text-[11px] text-[#8ea5b4]">
            VeinPay requires a cryptographically signed EIP-712 PaymentLink
            payload that has not been tampered with or revoked.
          </p>
        </div>
      ) : (
        <PayCheckout />
      )}
    </div>
  );
}

export default function StandalonePayRoute({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const resolvedParams = use(params);

  return (
    <div className="w-full max-w-[600px] mx-auto min-h-screen px-3.5 py-4 pb-20">
      <AppHeader />
      <JudgeStrip />

      <Suspense
        fallback={
          <div className="bg-[#16252f] border border-[#27404f] rounded-2xl p-8 text-center text-sm text-[#8ea5b4]">
            Loading payment link…
          </div>
        }
      >
        <StandalonePayContent handle={resolvedParams.handle} />
      </Suspense>

      <footer className="text-center text-[#8ea5b4] text-xs mt-8">
        Screened by TigerGraph · Verified by AIGI · Routed by Socket · Paid to Cake Wallet
      </footer>

      <SettlementSheet />
      <SettingsDrawer />
    </div>
  );
}
