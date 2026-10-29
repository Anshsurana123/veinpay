import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  clearVerifiedLinkPolicyStoreForTests,
  registerVerifiedLinkPolicy,
  signScanAttestation,
  verifyScanAttestation,
} from '@/lib/security/attestation';
import { AUTHORITATIVE_DEFAULT_POLICY, runFullScan } from '@/lib/graph/full-scan';
import { WALLET_PERSONAS } from '@/lib/graph/seed-topologies';
import { GET as getSocketQuote } from '@/app/api/socket/quote/route';

const CLEAN_WALLET = WALLET_PERSONAS[0].address; // 0x4F2a9c117034e8B1200499A1c3f88200000188E1
const TAINTED_2HOP_WALLET = WALLET_PERSONAS[1].address; // 0x99B10f4c2871e0944019a8F0010c8492000099B1
const SAMPLE_VAULT = '0x71C95911E9a5D330f4D621842EC243EE1343292e';

describe('Shared runFullScan() & Server Scan Attestation Gate (Issue 3)', () => {
  beforeEach(() => {
    clearVerifiedLinkPolicyStoreForTests();
  });

  it('Executes shared runFullScan() across seeded and live pipelines and produces deterministic receipt', async () => {
    const cleanOut = await runFullScan({
      targetWallet: CLEAN_WALLET,
      merchantWallet: SAMPLE_VAULT,
      chainId: 42161,
      policy: AUTHORITATIVE_DEFAULT_POLICY,
    });
    expect(cleanOut.scan.verdict).toBe('VERIFIED_CLEAN');
    expect(cleanOut.scan.socketUnlocked).toBe(true);

    const taintOut = await runFullScan({
      targetWallet: TAINTED_2HOP_WALLET,
      merchantWallet: SAMPLE_VAULT,
      chainId: 42161,
      policy: AUTHORITATIVE_DEFAULT_POLICY,
    });
    expect(taintOut.scan.verdict).toBe('INTERCEPTED_TAINT');
    expect(taintOut.scan.socketUnlocked).toBe(false);
  });

  it('Verifies HMAC scanAttestation and rejects missing proofOfControl, expired, tampered, or mismatched payer', () => {
    const validAttestation = signScanAttestation({
      payer: CLEAN_WALLET,
      linkId: 'ansh-audit',
      verdict: 'VERIFIED_CLEAN',
      socketUnlocked: true,
      proofOfControl: true,
      policy: AUTHORITATIVE_DEFAULT_POLICY,
    });

    const checkOk = verifyScanAttestation(validAttestation, {
      payer: CLEAN_WALLET,
      linkId: 'ansh-audit',
      policy: AUTHORITATIVE_DEFAULT_POLICY,
      requireProofOfControl: true,
    });
    expect(checkOk.valid).toBe(true);

    // Proof of control = false must be rejected for quotes
    const noPocAttestation = signScanAttestation({
      payer: CLEAN_WALLET,
      linkId: 'ansh-audit',
      verdict: 'VERIFIED_CLEAN',
      socketUnlocked: true,
      proofOfControl: false,
      policy: AUTHORITATIVE_DEFAULT_POLICY,
    });
    const checkNoPoc = verifyScanAttestation(noPocAttestation, {
      payer: CLEAN_WALLET,
      linkId: 'ansh-audit',
      policy: AUTHORITATIVE_DEFAULT_POLICY,
      requireProofOfControl: true,
    });
    expect(checkNoPoc.valid).toBe(false);
    expect(checkNoPoc.reason).toContain('proofOfControl=true');

    // Different payer address must be rejected
    const checkWrongPayer = verifyScanAttestation(validAttestation, {
      payer: TAINTED_2HOP_WALLET,
      linkId: 'ansh-audit',
      policy: AUTHORITATIVE_DEFAULT_POLICY,
    });
    expect(checkWrongPayer.valid).toBe(false);

    // Expired attestation must be rejected
    const checkExpired = verifyScanAttestation(validAttestation, {
      payer: CLEAN_WALLET,
      linkId: 'ansh-audit',
      policy: AUTHORITATIVE_DEFAULT_POLICY,
      nowMs: Date.now() + 10 * 60 * 1000,
    });
    expect(checkExpired.valid).toBe(false);
    expect(checkExpired.reason).toContain('expired');
  });

  it('Ignores client-supplied firewallEnabled=false / maxHops=1 on /api/socket/quote and enforces verified link policy + attestation', async () => {
    // Register authoritative link policy with 3-hop strict enforcement
    registerVerifiedLinkPolicy({
      linkId: 'strict-link-01',
      vaultAddress: SAMPLE_VAULT,
      policy: {
        firewallEnabled: true,
        maxHops: 3,
        cleanLinkEnabled: true,
        unbundleEnabled: true,
        socketAutoBridgeEnabled: true,
        sybilBlockThreshold: 10,
      },
    });

    // 1. Missing attestation -> 403 even if client passes firewallEnabled=false&maxHops=1
    const unattestedReq = new NextRequest(
      `http://localhost:3000/api/socket/quote?originChainId=8453&destinationChainId=8453&inputToken=USDC&outputToken=USDC&inputAmount=10000000&userAddress=${TAINTED_2HOP_WALLET}&receiverAddress=${SAMPLE_VAULT}&linkId=strict-link-01&firewallEnabled=false&maxHops=1`
    );
    const unattestedRes = await getSocketQuote(unattestedReq);
    expect(unattestedRes.status).toBe(403);

    // 2. Attestation signed for a spoofed 1-hop policy is rejected because policyHash mismatches the verified link's 3-hop policy
    const spoofedPolicyAttestation = signScanAttestation({
      payer: TAINTED_2HOP_WALLET,
      linkId: 'strict-link-01',
      verdict: 'VERIFIED_CLEAN',
      socketUnlocked: true,
      proofOfControl: true,
      policy: {
        firewallEnabled: false,
        maxHops: 1,
        cleanLinkEnabled: false,
        unbundleEnabled: false,
        socketAutoBridgeEnabled: true,
        sybilBlockThreshold: 99,
      },
    });
    const spoofedReq = new NextRequest(
      `http://localhost:3000/api/socket/quote?originChainId=8453&destinationChainId=8453&inputToken=USDC&outputToken=USDC&inputAmount=10000000&userAddress=${TAINTED_2HOP_WALLET}&receiverAddress=${SAMPLE_VAULT}&linkId=strict-link-01&firewallEnabled=false&maxHops=1&scanAttestation=${encodeURIComponent(spoofedPolicyAttestation)}`
    );
    const spoofedRes = await getSocketQuote(spoofedReq);
    expect(spoofedRes.status).toBe(403);

    // 3. Clean wallet with valid attestation + proofOfControl=true + matching link policy succeeds
    const cleanAttestation = signScanAttestation({
      payer: CLEAN_WALLET,
      linkId: 'strict-link-01',
      verdict: 'VERIFIED_CLEAN',
      socketUnlocked: true,
      proofOfControl: true,
      policy: {
        firewallEnabled: true,
        maxHops: 3,
        cleanLinkEnabled: true,
        unbundleEnabled: true,
        socketAutoBridgeEnabled: true,
        sybilBlockThreshold: 10,
      },
    });
    const cleanReq = new NextRequest(
      `http://localhost:3000/api/socket/quote?originChainId=8453&destinationChainId=8453&inputToken=USDC&outputToken=USDC&inputAmount=10000000&userAddress=${CLEAN_WALLET}&receiverAddress=${SAMPLE_VAULT}&linkId=strict-link-01&scanAttestation=${encodeURIComponent(cleanAttestation)}`
    );
    const cleanRes = await getSocketQuote(cleanReq);
    expect(cleanRes.status).toBe(200);
    const quoteBody = await cleanRes.json();
    expect(quoteBody.success).toBe(true);
    expect(quoteBody.source).toBe('SAME_CHAIN_DIRECT');
  });
});
