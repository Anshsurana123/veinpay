import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  tryExecuteLiveTigerGraphQuery,
  buildTigerGraphFailClosedScan,
} from '@/lib/graph/tigergraph-client';
import {
  assertReceiptSigningKeyConfigured,
  DEFAULT_RECEIPT_KEY_ID,
} from '@/lib/aigi/receipt-signer';
import {
  assertScanAttestationSecretConfigured,
  isVerdictAllowedForQuote,
} from '@/lib/security/attestation';
import { assertSessionSecretConfigured } from '@/lib/session/proof-of-control';
import {
  storeSignedLinkRecord,
  getStoredLinkRecord,
} from '@/lib/links/store';
import { verifyRevokeLinkSignature } from '@/lib/links/verify';
import { buildRevokeLinkTypedData } from '@/lib/links/eip712';
import { GET as getEvents } from '@/app/api/events/route';
import { POST as postAigiVerdict } from '@/app/api/aigi/verdict/route';
import {
  buildDeterministicFallbackQuote,
  fetchSocketCrossChainQuote,
} from '@/lib/socket/client';
import { evaluateOutboundPoisonRisk } from '@/lib/graph/poison-guard';
import {
  validateMultiProtocolAddress,
  validateMoneroAddress,
} from '@/lib/validators/address';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { runVeinPayFirewallTraversal } from '@/lib/graph/engine';
import type { FirewallPolicyConfig, SignedPaymentLinkPayload } from '@/types/veinpay';

const DEFAULT_POLICY: FirewallPolicyConfig = {
  firewallEnabled: true,
  maxHops: 3,
  cleanLinkEnabled: true,
  unbundleEnabled: true,
  socketAutoBridgeEnabled: true,
  sybilBlockThreshold: 10,
  inconclusivePolicy: 'BLOCK',
};

describe('Audit Remediations & PoC Verifications', () => {
  describe('1. Live TigerGraph Verdict & Fail-Closed Behavior', () => {
    it('buildTigerGraphFailClosedScan produces INCONCLUSIVE and socketUnlocked=false under BLOCK policy', () => {
      const scan = buildTigerGraphFailClosedScan(
        {
          targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
          merchantWallet: '0x1111111111111111111111111111111111111111',
          policy: { ...DEFAULT_POLICY, inconclusivePolicy: 'BLOCK' },
        },
        'TigerGraph RESTPP query failed with status 500',
        25
      );

      expect(scan.verdict).toBe('INCONCLUSIVE');
      expect(scan.socketUnlocked).toBe(false);
      expect(scan.vaultUriUnlocked).toBe(false);
      expect(scan.inconclusiveReason).toContain('TigerGraph RESTPP query failed with status 500');
    });

    it('buildTigerGraphFailClosedScan allows socketUnlocked=true only if inconclusivePolicy is WARN', () => {
      const scan = buildTigerGraphFailClosedScan(
        {
          targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
          merchantWallet: '0x1111111111111111111111111111111111111111',
          policy: { ...DEFAULT_POLICY, inconclusivePolicy: 'WARN' },
        },
        'TigerGraph RESTPP query timed out',
        30
      );

      expect(scan.verdict).toBe('INCONCLUSIVE');
      expect(scan.socketUnlocked).toBe(true);
      expect(scan.vaultUriUnlocked).toBe(true);
    });

    it('tryExecuteLiveTigerGraphQuery parses live envelope and enforces INTERCEPTED_TAINT', async () => {
      const origHost = process.env.TIGERGRAPH_HOST;
      const origToken = process.env.TIGERGRAPH_TOKEN;
      const origFetch = global.fetch;

      try {
        process.env.TIGERGRAPH_HOST = 'http://127.0.0.1:9000';
        process.env.TIGERGRAPH_TOKEN = 'test-token-123';

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            error: false,
            message: '',
            results: [
              {
                verdict: 'INTERCEPTED_TAINT',
                taint_hits: 2,
                min_taint_hop: 1,
                sybil_cluster_size: 0,
                nodes_scanned: 5,
                edges_traversed: 4,
              },
            ],
          }),
        }) as unknown as typeof fetch;

        const scan = await tryExecuteLiveTigerGraphQuery({
          targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
          merchantWallet: '0x1111111111111111111111111111111111111111',
          policy: DEFAULT_POLICY,
        });

        expect(scan).not.toBeNull();
        expect(scan!.verdict).toBe('INTERCEPTED_TAINT');
        expect(scan!.socketUnlocked).toBe(false);
        expect(scan!.vaultUriUnlocked).toBe(false);
        expect(scan!.executionSource).toBe('TIGERGRAPH_RESTPP_LIVE');
      } finally {
        if (origHost !== undefined) process.env.TIGERGRAPH_HOST = origHost;
        else delete process.env.TIGERGRAPH_HOST;
        if (origToken !== undefined) process.env.TIGERGRAPH_TOKEN = origToken;
        else delete process.env.TIGERGRAPH_TOKEN;
        global.fetch = origFetch;
      }
    });
  });

  describe('2. AIGI Signing Oracle & Production Secrets Guard', () => {
    it('POST /api/aigi/verdict rejects client scan verdict tampering', async () => {
      const drainerAddress = '0x99B1c402881a77e3d90123456789aB00000FDead';
      const genuineScan = runVeinPayFirewallTraversal({
        targetWallet: drainerAddress,
        merchantWallet: '0x1111111111111111111111111111111111111111',
        policy: DEFAULT_POLICY,
      });

      // Attacker attempts to forge a VERIFIED_CLEAN scan
      const forgedScan = {
        ...genuineScan,
        verdict: 'VERIFIED_CLEAN',
        socketUnlocked: true,
      };

      const req = new NextRequest('http://localhost:3000/api/aigi/verdict', {
        method: 'POST',
        body: JSON.stringify({ scan: forgedScan }),
      });

      const res = await postAigiVerdict(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('TAMPERED_SCAN_VERDICT');
    });

    it('assertReceiptSigningKeyConfigured throws in production when RECEIPT_SIGNING_KEY is missing', () => {
      const origEnv = process.env.NODE_ENV;
      const origKey = process.env.RECEIPT_SIGNING_KEY;
      try {
        (process.env as any).NODE_ENV = 'production';
        delete process.env.RECEIPT_SIGNING_KEY;
        expect(() => assertReceiptSigningKeyConfigured()).toThrow(
          'RECEIPT_SIGNING_KEY environment variable is required in production'
        );
      } finally {
        (process.env as any).NODE_ENV = origEnv;
        if (origKey !== undefined) process.env.RECEIPT_SIGNING_KEY = origKey;
      }
    });

    it('assertScanAttestationSecretConfigured throws in production when secrets are missing', () => {
      const origEnv = process.env.NODE_ENV;
      const origAttest = process.env.VEINPAY_ATTESTATION_SECRET;
      const origSession = process.env.VEINPAY_SESSION_SECRET;
      const origReceipt = process.env.RECEIPT_SIGNING_KEY;
      try {
        (process.env as any).NODE_ENV = 'production';
        delete process.env.VEINPAY_ATTESTATION_SECRET;
        delete process.env.VEINPAY_SESSION_SECRET;
        delete process.env.RECEIPT_SIGNING_KEY;
        expect(() => assertScanAttestationSecretConfigured()).toThrow(
          'VEINPAY_ATTESTATION_SECRET'
        );
      } finally {
        (process.env as any).NODE_ENV = origEnv;
        if (origAttest !== undefined) process.env.VEINPAY_ATTESTATION_SECRET = origAttest;
        if (origSession !== undefined) process.env.VEINPAY_SESSION_SECRET = origSession;
        if (origReceipt !== undefined) process.env.RECEIPT_SIGNING_KEY = origReceipt;
      }
    });

    it('assertSessionSecretConfigured throws in production when secrets are missing', () => {
      const origEnv = process.env.NODE_ENV;
      const origSession = process.env.VEINPAY_SESSION_SECRET;
      const origReceipt = process.env.RECEIPT_SIGNING_KEY;
      try {
        (process.env as any).NODE_ENV = 'production';
        delete process.env.VEINPAY_SESSION_SECRET;
        delete process.env.RECEIPT_SIGNING_KEY;
        expect(() => assertSessionSecretConfigured()).toThrow(
          'VEINPAY_SESSION_SECRET'
        );
      } finally {
        (process.env as any).NODE_ENV = origEnv;
        if (origSession !== undefined) process.env.VEINPAY_SESSION_SECRET = origSession;
        if (origReceipt !== undefined) process.env.RECEIPT_SIGNING_KEY = origReceipt;
      }
    });
  });

  describe('3. Events Endpoint Authorization Enforcement', () => {
    it('GET /api/events without linkId returns 401 UNAUTHORIZED_ACCESS when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/events');
      const res = await getEvents(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.errorCode).toBe('UNAUTHORIZED_ACCESS');
    });

    it('GET /api/events with linkId returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/events?linkId=test-link-123');
      const res = await getEvents(req);
      expect(res.status).toBe(401);
    });
  });

  describe('4. Link Revocation Authorization & Takeover Protection', () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const uniqueSuffix = Date.now().toString(36);
    const linkId = 'link-' + uniqueSuffix;
    const handle = 'alice-' + uniqueSuffix;

    const basePayload: SignedPaymentLinkPayload = {
      version: 1,
      linkId,
      handle,
      signer: owner.address,
      amount: '50.00',
      openAmount: false,
      asset: 'USDC',
      destinationChainId: 8453,
      settlementMode: 'EVM_SOCKET',
      vaultAddress: owner.address,
      policyHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      policy: DEFAULT_POLICY,
      createdAt: Math.floor(Date.now() / 1000).toString(),
      expiresAt: (Math.floor(Date.now() / 1000) + 86400).toString(),
    };

    it('storeSignedLinkRecord prevents an attacker from overwriting another signers linkId', () => {
      const firstStore = storeSignedLinkRecord({
        payload: basePayload,
        encodedPayload: 'base64payload1',
        signature: '0x111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111b',
        trustLevel: 'SIGNED_UNPROVEN',
      });
      expect(firstStore.record).toBeDefined();

      // Attacker attempts to overwrite the linkId with their own address
      const attackerPayload: SignedPaymentLinkPayload = {
        ...basePayload,
        signer: attacker.address,
        vaultAddress: attacker.address,
      };

      expect(() => {
        storeSignedLinkRecord({
          payload: attackerPayload,
          encodedPayload: 'base64payload2',
          signature: '0x222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222221b',
          trustLevel: 'SIGNED_UNPROVEN',
        });
      }).toThrow('LINK_ID_COLLISION_DIFFERENT_SIGNER');
    });

    it('verifyRevokeLinkSignature rejects an attacker signature trying to revoke victims link', async () => {
      const issuedAt = Math.floor(Date.now() / 1000).toString();
      const attackerRevokeMsg = {
        linkId,
        signer: attacker.address,
        issuedAt,
      };

      const typedData = buildRevokeLinkTypedData(attackerRevokeMsg);
      const attackerSig = await attacker.signTypedData(typedData);

      const verifyRes = await verifyRevokeLinkSignature({
        revokeMessage: attackerRevokeMsg,
        signature: attackerSig,
      });

      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.reason).toContain('does not match the original link signer');
    });
  });

  describe('5. Socket Deterministic Fallback & Recipient Validation', () => {
    it('buildDeterministicFallbackQuote returns non-executable quote with success=false', () => {
      const quote = buildDeterministicFallbackQuote(
        {
          originChainId: 42161,
          destinationChainId: 8453,
          inputToken: 'USDC',
          outputToken: 'USDC',
          inputAmount: '1000000',
          userAddress: '0x1111111111111111111111111111111111111111',
          receiverAddress: '0x2222222222222222222222222222222222222222',
        },
        'Socket V3 timed out',
        3500
      );

      expect(quote.success).toBe(false);
      expect(quote.statusCode).toBe(503);
      expect(quote.source).toBe('FALLBACK_DETERMINISTIC');
      expect(quote.result.routes[0].approval).toBeNull();
      expect(quote.result.routes[0].txData?.object).toBeUndefined();
    });

    it('fetchSocketCrossChainQuote rejects diversion if returned receiverAddress does not match', async () => {
      const origFetch = global.fetch;
      try {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            statusCode: 200,
            result: {
              originChainId: 42161,
              destinationChainId: 8453,
              userAddress: '0x1111111111111111111111111111111111111111',
              // Returned recipient diverted!
              receiverAddress: '0x9999999999999999999999999999999999999999',
              routes: [
                {
                  routeId: 'route_1',
                  output: { amount: '1000000' },
                  userOps: [],
                },
              ],
            },
          }),
        }) as unknown as typeof fetch;

        const quote = await fetchSocketCrossChainQuote({
          originChainId: 42161,
          destinationChainId: 8453,
          inputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          inputAmount: '1000000',
          userAddress: '0x1111111111111111111111111111111111111111',
          receiverAddress: '0x2222222222222222222222222222222222222222',
        });

        expect(quote.success).toBe(false);
        expect(quote.statusCode).toBe(502);
        expect(quote.fallbackReason).toContain('Security Intercept: Socket API returned receiverAddress');
      } finally {
        global.fetch = origFetch;
      }
    });
  });

  describe('6. PoisonGraph Flow C Honesty', () => {
    it('evaluates new recipient honestly without fabricating dust transfers', () => {
      const result = evaluateOutboundPoisonRisk({
        candidateInput: '0x3333333333333333333333333333333333333333',
        trustedContacts: [], // No prior contacts
      });

      expect(result.verdict).toBe('VERIFIED_FIRST_TIME_RECIPIENT');
      expect(result.dustOutDegree).toBe(0);
      expect(result.summaryNarrative).toContain('First-Time Recipient — No Prior History');
      expect(result.summaryNarrative).not.toContain('4,210');
      expect(result.summaryNarrative).not.toContain('Verified Zero Dust-Factory Activity');
    });
  });

  describe('7. Monero Base58 & Keccak-256 Checksum Validation', () => {
    it('validates a spec-valid Monero subaddress from test vectors', () => {
      const validSubaddress =
        '888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H';
      const check = validateMoneroAddress(validSubaddress);
      expect(check.valid).toBe(true);

      const multi = validateMultiProtocolAddress(validSubaddress, 'XMR_SUBADDRESS');
      expect(multi.valid).toBe(true);
      expect(multi.checksumValid).toBe(true);
    });

    it('rejects fabricated Monero address with invalid Keccak-256 checksum', () => {
      // 95-character address starting with '4' followed by 'A's
      const fakeMonero = '4' + 'A'.repeat(94);
      const check = validateMoneroAddress(fakeMonero);
      expect(check.valid).toBe(false);
      expect(check.error).toContain('Keccak-256 checksum verification failed');

      const multi = validateMultiProtocolAddress(fakeMonero, 'XMR_SUBADDRESS');
      expect(multi.valid).toBe(false);
      expect(multi.checksumValid).toBe(false);
    });
  });

  describe('8. Attestation Policy Enforcement (INCONCLUSIVE WARN vs BLOCK)', () => {
    it('allows INCONCLUSIVE quote when socketUnlocked is true (WARN policy)', () => {
      const allowed = isVerdictAllowedForQuote('INCONCLUSIVE', true);
      expect(allowed).toBe(true);
    });

    it('blocks INCONCLUSIVE quote when socketUnlocked is false (BLOCK policy)', () => {
      const allowed = isVerdictAllowedForQuote('INCONCLUSIVE', false);
      expect(allowed).toBe(false);
    });

    it('always blocks INTERCEPTED_TAINT and INTERCEPTED_SYBIL regardless', () => {
      expect(isVerdictAllowedForQuote('INTERCEPTED_TAINT', false)).toBe(false);
      expect(isVerdictAllowedForQuote('INTERCEPTED_TAINT', true)).toBe(false);
      expect(isVerdictAllowedForQuote('INTERCEPTED_SYBIL', false)).toBe(false);
      expect(isVerdictAllowedForQuote('INTERCEPTED_POISONING', false)).toBe(false);
    });
  });
});
