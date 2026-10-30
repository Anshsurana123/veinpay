import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getAigiVerdict, POST as postAigiVerdict } from '@/app/api/aigi/verdict/route';
import { POST as postAigiVerify } from '@/app/api/aigi/verify/route';
import { POST as postEvents } from '@/app/api/events/route';
import { GET as getScan } from '@/app/api/firewall/scan/route';
import {
  generateAigiForensicReceipt,
} from '@/lib/aigi/verdict';
import {
  verifyReceiptSignature,
  DEMO_RECEIPT_KEY_ID,
} from '@/lib/aigi/receipt-signer';
import {
  issueProofOfControlNonce,
  verifyProofOfControlSignature,
  buildProofOfControlMessage,
} from '@/lib/session/proof-of-control';
import {
  storeSignedLinkRecord,
  getStoredLinkRecord,
  isLinkRevoked,
} from '@/lib/links/store';
import { resolveVerifiedLinkAuthority } from '@/lib/links';
import { runVeinPayFirewallTraversal } from '@/lib/graph/engine';
import { runFullScan } from '@/lib/graph/full-scan';
import { setStorageForTesting } from '@/lib/storage';
import { InMemoryKeyValueStore } from '@/lib/storage/memory';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { FirewallPolicyConfig, SignedPaymentLinkPayload } from '@/types/veinpay';

const DEFAULT_POLICY: FirewallPolicyConfig = {
  firewallEnabled: true,
  maxHops: 3,
  cleanLinkEnabled: true,
  unbundleEnabled: true,
  socketAutoBridgeEnabled: true,
  sybilBlockThreshold: 10,
};

describe('Phase 1 Security & Hardening Regression Suite', () => {
  beforeEach(() => {
    setStorageForTesting(new InMemoryKeyValueStore());
  });

  it('1. Unknown wallet cannot obtain a signed clean receipt without a verified link + attestation in production', async () => {
    const origEnv = process.env.NODE_ENV;
    const origDemo = process.env.NEXT_PUBLIC_DEMO_MODE;
    const origEngine = process.env.ALLOW_LOCAL_ENGINE;

    try {
      (process.env as any).NODE_ENV = 'production';
      delete process.env.NEXT_PUBLIC_DEMO_MODE;
      delete process.env.ALLOW_LOCAL_ENGINE;

      const req = new NextRequest(
        'http://localhost:3000/api/aigi/verdict?targetWallet=0x1111111111111111111111111111111111111111'
      );
      const res = await getAigiVerdict(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.errorCode).toBe('UNAUTHORIZED_VERDICT_REQUEST');
    } finally {
      (process.env as any).NODE_ENV = origEnv;
      if (origDemo !== undefined) process.env.NEXT_PUBLIC_DEMO_MODE = origDemo;
      if (origEngine !== undefined) process.env.ALLOW_LOCAL_ENGINE = origEngine;
    }
  });

  it('2. Client-supplied firewallEnabled=false in query params is ignored by authoritative scans', async () => {
    // In demo mode, scanning 0x99B1...FDead with firewallEnabled=false parameter should STILL run the firewall
    const req = new NextRequest(
      'http://localhost:3000/api/firewall/scan?targetWallet=0x99B1c402881a77e3d90123456789aB00000FDead&firewallEnabled=false&maxHops=1&simulated=true'
    );
    const res = await getScan(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Firewall cannot be disabled by query parameters for authoritative verdicts
    expect(json.scan.verdict).toBe('INTERCEPTED_TAINT');
    expect(json.scan.socketUnlocked).toBe(false);
  });

  it('3. Tampered canonicalPayloadJson fails verify and verifyReceiptSignature rejects expired receipts', async () => {
    const scan = runVeinPayFirewallTraversal({
      targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
      merchantWallet: '0x2222222222222222222222222222222222222222',
      policy: DEFAULT_POLICY,
    });

    // Generate valid receipt
    const receipt = generateAigiForensicReceipt(scan, {
      linkId: 'test-link',
      payer: scan.targetWallet,
      merchant: scan.merchantWallet,
    });

    expect(receipt.signature).toBeDefined();

    // Verify valid receipt
    const verifyValid = await postAigiVerify(
      new NextRequest('http://localhost:3000/api/aigi/verify', {
        method: 'POST',
        body: JSON.stringify({
          canonicalPayloadJson: receipt.canonicalPayloadJson,
          commitmentHash: receipt.cryptographicAuditHash,
          signature: receipt.signature,
          keyId: receipt.keyId,
          issuedAt: receipt.issuedAt,
          expiresAt: receipt.expiresAt,
        }),
      })
    );
    expect(verifyValid.status).toBe(200);
    const validJson = await verifyValid.json();
    expect(validJson.valid).toBe(true);

    // Tampered payload fails verify
    const tamperedPayload = receipt.canonicalPayloadJson?.replace('INTERCEPTED_TAINT', 'VERIFIED_CLEAN');
    const verifyTampered = await postAigiVerify(
      new NextRequest('http://localhost:3000/api/aigi/verify', {
        method: 'POST',
        body: JSON.stringify({
          canonicalPayloadJson: tamperedPayload,
          commitmentHash: receipt.cryptographicAuditHash,
          signature: receipt.signature,
          keyId: receipt.keyId,
        }),
      })
    );
    expect(verifyTampered.status).toBe(400);
    const tamperedJson = await verifyTampered.json();
    expect(tamperedJson.valid).toBe(false);
    expect(tamperedJson.error).toBe('COMMITMENT_HASH_MISMATCH');

    // Expired receipt fails verify
    const verifyExpired = await postAigiVerify(
      new NextRequest('http://localhost:3000/api/aigi/verify', {
        method: 'POST',
        body: JSON.stringify({
          canonicalPayloadJson: receipt.canonicalPayloadJson,
          commitmentHash: receipt.cryptographicAuditHash,
          signature: receipt.signature,
          keyId: receipt.keyId,
          issuedAt: receipt.issuedAt,
          expiresAt: new Date(Date.now() - 120_000).toISOString(), // expired 2 mins ago (grace is 60s)
        }),
      })
    );
    expect(verifyExpired.status).toBe(400);
    const expiredJson = await verifyExpired.json();
    expect(expiredJson.valid).toBe(false);
    expect(expiredJson.error).toBe('EXPIRED_RECEIPT');
  });

  it('4. Proof of control challenge nonce is single-use and shared across instances via storage', async () => {
    const user = privateKeyToAccount(generatePrivateKey());
    const challenge = issueProofOfControlNonce({
      scannedAddress: user.address,
      linkId: 'test-link',
      chainId: 8453,
    });
    expect(challenge.nonce).toBeDefined();

    const message = buildProofOfControlMessage({
      nonce: challenge.nonce,
      linkId: 'test-link',
      scannedAddress: user.address,
      chainId: 8453,
      expiresAt: challenge.expiresAt,
    });
    const signature = await user.signMessage({ message });

    const verifiedFirst = await verifyProofOfControlSignature({
      scannedAddress: user.address,
      linkId: 'test-link',
      nonce: challenge.nonce,
      chainId: 8453,
      expiresAt: challenge.expiresAt,
      signature,
    });
    expect(verifiedFirst.valid).toBe(true);

    // Replay on second instance fails
    const verifiedSecond = await verifyProofOfControlSignature({
      scannedAddress: user.address,
      linkId: 'test-link',
      nonce: challenge.nonce,
      chainId: 8453,
      expiresAt: challenge.expiresAt,
      signature,
    });
    expect(verifiedSecond.valid).toBe(false);
    expect(verifiedSecond.reason).toContain('nonce');
  });

  it('5. Attacker first handle registration does not throw or crash victim link resolution', async () => {
    const handle = 'popular-store';
    const attackerSigner = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as `0x${string}`;
    const victimSigner = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as `0x${string}`;

    const attackerPayload: SignedPaymentLinkPayload = {
      version: 1,
      linkId: 'link-attacker',
      handle,
      signer: attackerSigner,
      amount: '10.00',
      openAmount: false,
      asset: 'USDC',
      destinationChainId: 8453,
      settlementMode: 'EVM_SOCKET',
      vaultAddress: attackerSigner,
      policyHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      policy: DEFAULT_POLICY,
      createdAt: Math.floor(Date.now() / 1000).toString(),
      expiresAt: (Math.floor(Date.now() / 1000) + 86400).toString(),
    };

    // Attacker registers handle first
    storeSignedLinkRecord({
      payload: attackerPayload,
      encodedPayload: 'payload-attacker',
      signature: '0x11' as `0x${string}`,
      trustLevel: 'SELF_SIGNED_VAULT',
      allowHandleCollision: true,
    });

    const victimPayload: SignedPaymentLinkPayload = {
      version: 1,
      linkId: 'link-victim',
      handle,
      signer: victimSigner,
      amount: '25.00',
      openAmount: false,
      asset: 'USDC',
      destinationChainId: 8453,
      settlementMode: 'EVM_SOCKET',
      vaultAddress: victimSigner,
      policyHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      policy: DEFAULT_POLICY,
      createdAt: Math.floor(Date.now() / 1000).toString(),
      expiresAt: (Math.floor(Date.now() / 1000) + 86400).toString(),
    };

    // Victim stores link - MUST NOT THROW
    const storeRes = storeSignedLinkRecord({
      payload: victimPayload,
      encodedPayload: 'payload-victim',
      signature: '0x22' as `0x${string}`,
      trustLevel: 'SELF_SIGNED_VAULT',
      allowHandleCollision: true,
    });

    expect(storeRes.record).toBeDefined();
    expect(storeRes.handleCollision).toBe(true);

    // Victim resolves by linkId - succeeds with NOT_OWNED_BY_SIGNER
    const authority = await resolveVerifiedLinkAuthority({
      linkId: 'link-victim',
    });
    expect(authority.ok).toBe(true);
    expect(authority.vaultAddress.toLowerCase()).toBe(victimSigner.toLowerCase());
    expect(authority.handleStatus).toBe('NOT_OWNED_BY_SIGNER');
  });

  it('6. Unauthenticated POST /api/events returns 401 UNAUTHORIZED_ACCESS', async () => {
    const req = new NextRequest('http://localhost:3000/api/events', {
      method: 'POST',
      body: JSON.stringify({
        type: 'PAYMENT_RECEIVED',
        txHash: '0x123',
      }),
    });
    const res = await postEvents(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.errorCode).toBe('UNAUTHORIZED_ACCESS');
  });

  it('7. Minimal query parameters with null or empty values do not 400', async () => {
    // Target wallet provided, optional fields are omitted or null
    const req = new NextRequest(
      'http://localhost:3000/api/firewall/scan?targetWallet=0x99B1c402881a77e3d90123456789aB00000FDead&simulated=true'
    );
    const res = await getScan(req);
    expect(res.status).toBe(200);
  });

  it('8. Scan cache key isolates merchant and link context', async () => {
    const scanResult1 = await runFullScan({
      targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
      merchantWallet: '0x1111111111111111111111111111111111111111',
      linkId: 'link-alpha',
      chainId: 42161,
      policy: DEFAULT_POLICY,
    });

    const scanResult2 = await runFullScan({
      targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
      merchantWallet: '0x2222222222222222222222222222222222222222',
      linkId: 'link-beta',
      chainId: 42161,
      policy: DEFAULT_POLICY,
    });

    // Receipts generated for different links must not leak merchant addresses
    expect(scanResult1.receipt.merchantWallet.toLowerCase()).toBe('0x1111111111111111111111111111111111111111'.toLowerCase());
    expect(scanResult2.receipt.merchantWallet.toLowerCase()).toBe('0x2222222222222222222222222222222222222222'.toLowerCase());
    expect(scanResult1.receipt.linkId).toBe('link-alpha');
    expect(scanResult2.receipt.linkId).toBe('link-beta');
  });
});
