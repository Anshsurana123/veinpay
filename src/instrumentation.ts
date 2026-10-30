/**
 * VeilPay — Next.js Server Boot & Instrumentation Hook
 * File: src/instrumentation.ts
 *
 * Enforces production security assertions:
 * 1. Storage configuration (Upstash Redis URL/Token or explicit ALLOW_EPHEMERAL_STATE=true)
 * 2. Distinct cryptographic secrets (RECEIPT_SIGNING_KEY, VEILPAY_SESSION_SECRET, VEILPAY_ATTESTATION_SECRET)
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertStorageConfigured } = await import('@/lib/storage');
    const { assertReceiptSigningKeyConfigured } = await import(
      '@/lib/aigi/receipt-signer'
    );
    const { assertSessionSecretConfigured } = await import(
      '@/lib/session/proof-of-control'
    );
    const { assertScanAttestationSecretConfigured } = await import(
      '@/lib/security/attestation'
    );

    // Run security boot checks
    assertStorageConfigured();
    assertReceiptSigningKeyConfigured();
    assertSessionSecretConfigured();
    assertScanAttestationSecretConfigured();
  }
}
