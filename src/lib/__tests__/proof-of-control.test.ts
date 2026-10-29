import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import {
  areAddressesMatchingSigner,
  clearProofOfControlStoreForTests,
  evaluatePayerQuoteAndBroadcastEligibility,
  issueProofOfControlNonce,
  verifyProofOfControlSignature,
  verifyProofOfControlToken,
} from '@/lib/session/proof-of-control';
import { POST as postNonceRoute } from '@/app/api/session/nonce/route';
import { POST as postVerifyRoute } from '@/app/api/session/verify/route';

const TEST_PK_1 =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_PK_2 =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

const account1 = privateKeyToAccount(TEST_PK_1);
const account2 = privateKeyToAccount(TEST_PK_2);

describe('Proof of Control & Signer-to-Scanned-Wallet Binding (Issue 2)', () => {
  beforeEach(() => {
    clearProofOfControlStoreForTests();
  });

  it('Issues a nonce challenge via POST /api/session/nonce and verifies viem signature via POST /api/session/verify', async () => {
    const nonceReq = new NextRequest('http://localhost:3000/api/session/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkId: 'ansh-audit',
        vaultAddress: account2.address,
        scannedAddress: account1.address,
        chainId: 8453,
      }),
    });

    const nonceRes = await postNonceRoute(nonceReq);
    expect(nonceRes.status).toBe(200);
    const challenge = await nonceRes.json();
    expect(challenge.nonce).toMatch(/^0x[0-9a-f]{32}$/);
    expect(challenge.scannedAddress).toBe(account1.address);
    expect(challenge.vaultAddress).toBe(account2.address);
    expect(challenge.message).toContain(account1.address.toLowerCase());
    expect(challenge.message).toContain(`Vault Address: ${account2.address.toLowerCase()}`);
    expect(challenge.message).toContain('Link ID: ansh-audit');

    const signature = await account1.signMessage({
      message: challenge.message,
    });

    const verifyReq = new NextRequest('http://localhost:3000/api/session/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: challenge.nonce,
        linkId: challenge.linkId,
        vaultAddress: challenge.vaultAddress,
        scannedAddress: challenge.scannedAddress,
        chainId: challenge.chainId,
        expiresAt: challenge.expiresAt,
        signature,
      }),
    });

    const verifyRes = await postVerifyRoute(verifyReq);
    expect(verifyRes.status).toBe(200);
    const verifyData = await verifyRes.json();
    expect(verifyData.valid).toBe(true);
    expect(typeof verifyData.token).toBe('string');

    // Verify token binds scannedAddress, vaultAddress, linkId, and chainId
    const tokenCheck = verifyProofOfControlToken(verifyData.token, {
      scannedAddress: account1.address.toLowerCase(),
      vaultAddress: account2.address,
      linkId: 'ansh-audit',
      chainId: 8453,
    });
    expect(tokenCheck.valid).toBe(true);
    expect(tokenCheck.payload?.proofOfControl).toBe(true);
    expect(tokenCheck.payload?.vaultAddress.toLowerCase()).toBe(account2.address.toLowerCase());

    // Mismatched vault address check
    const mismatchVaultCheck = verifyProofOfControlToken(verifyData.token, {
      scannedAddress: account1.address.toLowerCase(),
      vaultAddress: '0x1111111111111111111111111111111111111111',
      linkId: 'ansh-audit',
      chainId: 8453,
    });
    expect(mismatchVaultCheck.valid).toBe(false);
    expect(mismatchVaultCheck.reason).toContain('does not match expected destination vault');

    // Replay of the same nonce must be rejected
    const replayRes = await verifyProofOfControlSignature({
      nonce: challenge.nonce,
      linkId: challenge.linkId,
      scannedAddress: challenge.scannedAddress,
      chainId: challenge.chainId,
      expiresAt: challenge.expiresAt,
      signature,
    });
    expect(replayRes.valid).toBe(false);
    expect(replayRes.reason).toContain('already been used');
  });

  it('Rejects signature when connected signer differs from scannedAddress or when challenge expires', async () => {
    const challenge = issueProofOfControlNonce({
      linkId: 'goa.eth',
      scannedAddress: account1.address,
      chainId: 42161,
    });

    // Account 2 signs challenge meant for Account 1
    const wrongSig = await account2.signMessage({
      message: challenge.message,
    });

    const wrongSignerCheck = await verifyProofOfControlSignature({
      nonce: challenge.nonce,
      linkId: challenge.linkId,
      scannedAddress: challenge.scannedAddress,
      chainId: challenge.chainId,
      expiresAt: challenge.expiresAt,
      signature: wrongSig,
    });
    expect(wrongSignerCheck.valid).toBe(false);
    expect(wrongSignerCheck.reason).toContain('does not match scannedAddress');

    // Expired challenge is rejected even with valid signature from Account 1
    const validSig = await account1.signMessage({
      message: challenge.message,
    });
    const expiredCheck = await verifyProofOfControlSignature({
      nonce: challenge.nonce,
      linkId: challenge.linkId,
      scannedAddress: challenge.scannedAddress,
      chainId: challenge.chainId,
      expiresAt: challenge.expiresAt,
      signature: validSig,
      nowMs: Date.parse(challenge.expiresAt) + 5_000,
    });
    expect(expiredCheck.valid).toBe(false);
    expect(expiredCheck.reason).toContain('expired');
  });

  it('Enforces case-insensitive signer matching and keeps preset personas and pasted addresses scan-only', () => {
    expect(
      areAddressesMatchingSigner(
        account1.address.toLowerCase(),
        account1.address.toUpperCase().replace('0X', '0x')
      )
    ).toBe(true);
    expect(areAddressesMatchingSigner(account1.address, account2.address)).toBe(
      false
    );
    expect(areAddressesMatchingSigner(null, account1.address)).toBe(false);

    // Preset persona -> scan-only even if wallet is connected
    const personaCheck = evaluatePayerQuoteAndBroadcastEligibility({
      activePersonaId: 'persona-1',
      connectedAddress: account1.address,
      scannedAddress: account1.address,
      proofOfControlToken: 'dummy.token',
    });
    expect(personaCheck.isScanOnly).toBe(true);
    expect(personaCheck.canQuote).toBe(false);
    expect(personaCheck.canBroadcast).toBe(false);

    // Pasted custom address -> scan-only
    const customCheck = evaluatePayerQuoteAndBroadcastEligibility({
      activePersonaId: 'custom',
      connectedAddress: account1.address,
      scannedAddress: account1.address,
      proofOfControlToken: 'dummy.token',
    });
    expect(customCheck.isScanOnly).toBe(true);
    expect(customCheck.canQuote).toBe(false);
    expect(customCheck.canBroadcast).toBe(false);

    // Reown connected wallet with mismatched address -> scan-only
    const mismatchCheck = evaluatePayerQuoteAndBroadcastEligibility({
      activePersonaId: 'reown-connected',
      connectedAddress: account2.address,
      scannedAddress: account1.address,
      proofOfControlToken: 'dummy.token',
    });
    expect(mismatchCheck.isScanOnly).toBe(true);
    expect(mismatchCheck.canQuote).toBe(false);
    expect(mismatchCheck.canBroadcast).toBe(false);

    // Reown connected wallet with matching address AND proofOfControlToken -> unlocked
    const verifiedCheck = evaluatePayerQuoteAndBroadcastEligibility({
      activePersonaId: 'reown-connected',
      connectedAddress: account1.address.toLowerCase(),
      scannedAddress: account1.address,
      proofOfControlToken: 'signed.token',
    });
    expect(verifiedCheck.isScanOnly).toBe(false);
    expect(verifiedCheck.canQuote).toBe(true);
    expect(verifiedCheck.canBroadcast).toBe(true);
  });
});
