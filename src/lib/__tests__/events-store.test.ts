import { describe, expect, it, beforeEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { InMemoryEventStore } from '@/lib/events/store';
import { verifyOnChainSettlementReceipt } from '@/lib/events/verify-receipt';
import {
  clearLinkStoreForTests,
  clearReadActivityStoreForTests,
  issueReadActivityChallenge,
  storeSignedLinkRecord,
  verifyReadActivitySignature,
  buildReadActivityTypedData,
} from '@/lib/links';
import { createPaymentLinkPayload } from '@/lib/links/eip712';
import { encodeSignedLinkPayloadToBase64Url } from '@/lib/links/canonical';

const TEST_RECEIVER_PK =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_OTHER_PK =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

const receiverAccount = privateKeyToAccount(TEST_RECEIVER_PK);
const otherAccount = privateKeyToAccount(TEST_OTHER_PK);

describe('Issue 8: Server-backed Activity feed & On-chain receipt verification', () => {
  beforeEach(() => {
    clearLinkStoreForTests();
    clearReadActivityStoreForTests();
  });

  describe('EventStore In-Memory Implementation', () => {
    it('Reports non-persistent status and stores events accurately', async () => {
      const store = new InMemoryEventStore();
      expect(store.isPersistent).toBe(false);

      const evt1 = await store.recordEvent({
        linkId: 'link-abc-123',
        eventType: 'SCAN_RESULT',
        status: 'BLOCKED',
        simulated: false,
        payerAddress: '0x99B1c402881a77e3d90123456789aB00000FDead',
        receiverVault: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        amount: '100.00',
        asset: 'USDC',
        sourceChainId: 42161,
        sourceChainName: 'Arbitrum',
        verdict: 'INTERCEPTED_TAINT',
      });

      expect(evt1.id).toBeDefined();
      expect(evt1.status).toBe('BLOCKED');
      expect(evt1.simulated).toBe(false);

      const events = await store.getEvents({ linkId: 'link-abc-123' });
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(evt1.id);
    });

    it('Excludes simulated events from threat metrics and settled volume counters', async () => {
      const store = new InMemoryEventStore();

      // 1 real blocked event
      await store.recordEvent({
        linkId: 'link-test',
        eventType: 'SCAN_RESULT',
        status: 'BLOCKED',
        simulated: false,
        payerAddress: '0x1111111111111111111111111111111111111111',
        receiverVault: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        amount: '50.00',
        asset: 'USDC',
        sourceChainId: 42161,
        sourceChainName: 'Arbitrum',
      });

      // 5 simulated blocked events
      for (let i = 0; i < 5; i++) {
        await store.recordEvent({
          linkId: 'link-test',
          eventType: 'SCAN_RESULT',
          status: 'BLOCKED',
          simulated: true,
          payerAddress: '0x99B1c402881a77e3d90123456789aB00000FDead',
          receiverVault: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          amount: '250.00',
          asset: 'USDC',
          sourceChainId: 42161,
          sourceChainName: 'Arbitrum',
        });
      }

      // 1 real confirmed settlement
      await store.recordEvent({
        linkId: 'link-test',
        eventType: 'SETTLEMENT_CONFIRMED',
        status: 'CONFIRMED',
        simulated: false,
        payerAddress: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
        receiverVault: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        amount: '200.00',
        asset: 'USDC',
        sourceChainId: 42161,
        sourceChainName: 'Arbitrum',
      });

      // 2 simulated confirmed settlements
      for (let i = 0; i < 2; i++) {
        await store.recordEvent({
          linkId: 'link-test',
          eventType: 'SETTLEMENT_CONFIRMED',
          status: 'CONFIRMED',
          simulated: true,
          payerAddress: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
          receiverVault: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          amount: '1000.00',
          asset: 'USDC',
          sourceChainId: 42161,
          sourceChainName: 'Arbitrum',
        });
      }

      const metrics = await store.getThreatMetrics('link-test');

      // Threat count must strictly be 1 (excluding the 5 simulated ones)
      expect(metrics.totalThreatsIntercepted).toBe(1);
      // Volume must strictly be 200 (excluding the 2000 simulated volume)
      expect(metrics.totalSettledVolumeUsd).toBe(200);
      expect(metrics.liveEventsCount).toBe(2);
    });

    it('Updates pending events to confirmed or failed', async () => {
      const store = new InMemoryEventStore();

      const evt = await store.recordEvent({
        linkId: 'link-1',
        eventType: 'SETTLEMENT_ATTEMPT',
        status: 'PENDING',
        simulated: false,
        payerAddress: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
        receiverVault: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        amount: '150.00',
        asset: 'USDC',
        sourceChainId: 42161,
        sourceChainName: 'Arbitrum',
      });

      const updated = await store.updateEvent(evt.id, {
        status: 'CONFIRMED',
        txHash: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      });

      expect(updated?.status).toBe('CONFIRMED');
      expect(updated?.txHash).toContain('0xabcdef');
    });
  });

  describe('Receipt Verification & BTC/XMR Policy', () => {
    it('BTC Silent Payments and Monero Subaddresses CAN NEVER BE CONFIRMED on EVM', async () => {
      const btcResult = await verifyOnChainSettlementReceipt({
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        chainId: 42161,
        settlementMode: 'BTC_SILENT_PAYMENT',
      });

      expect(btcResult.status).toBe('CLAIMED_UNVERIFIED');
      expect(btcResult.verified).toBe(false);

      const xmrResult = await verifyOnChainSettlementReceipt({
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        chainId: 42161,
        settlementMode: 'XMR_SUBADDRESS',
      });

      expect(xmrResult.status).toBe('CLAIMED_UNVERIFIED');
      expect(xmrResult.verified).toBe(false);
    });

    it('Verifies EVM receipts using public client status', async () => {
      const validTxHash =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      // 1. Success receipt
      const successResult = await verifyOnChainSettlementReceipt({
        txHash: validTxHash,
        chainId: 42161,
        settlementMode: 'EVM_SOCKET',
        mockClient: {
          getTransactionReceipt: async () => ({
            status: 'success',
            to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
            blockNumber: 123456n,
          }),
        },
      });

      expect(successResult.status).toBe('CONFIRMED');
      expect(successResult.verified).toBe(true);
      expect(successResult.blockNumber).toBe(123456);

      // 2. Reverted receipt
      const revertedResult = await verifyOnChainSettlementReceipt({
        txHash: validTxHash,
        chainId: 42161,
        settlementMode: 'EVM_SOCKET',
        mockClient: {
          getTransactionReceipt: async () => ({
            status: 'reverted',
            to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
            blockNumber: 123457n,
          }),
        },
      });

      expect(revertedResult.status).toBe('FAILED');
      expect(revertedResult.verified).toBe(false);

      // 3. Null receipt (pending in mempool)
      const pendingResult = await verifyOnChainSettlementReceipt({
        txHash: validTxHash,
        chainId: 42161,
        settlementMode: 'EVM_SOCKET',
        mockClient: {
          getTransactionReceipt: async () => null,
        },
      });

      expect(pendingResult.status).toBe('PENDING');
      expect(pendingResult.verified).toBe(false);
    });
  });

  describe('Receiver Access Auth via EIP-712 ReadActivity', () => {
    it('Requires short-lived EIP-712 ReadActivity signature from link signer to access receiver feed', async () => {
      const payload = createPaymentLinkPayload({
        handle: 'secure-receiver',
        amount: '100.00',
        asset: 'USDC',
        destinationChainId: 8453,
        settlementMode: 'EVM_SOCKET',
        vaultAddress: receiverAccount.address,
        signer: receiverAccount.address,
        policy: {
          firewallEnabled: true,
          maxHops: 3,
          cleanLinkEnabled: true,
          unbundleEnabled: true,
          sybilBlockThreshold: 10,
          socketAutoBridgeEnabled: true,
          inconclusivePolicy: 'BLOCK',
        },
      });

      const canonicalEncoded = encodeSignedLinkPayloadToBase64Url(payload);
      storeSignedLinkRecord({
        payload,
        encodedPayload: canonicalEncoded,
        signature: '0x1234',
        trustLevel: 'PROVEN',
      });

      // Issue challenge
      const challenge = issueReadActivityChallenge(payload.linkId);
      expect(challenge.linkId).toBe(payload.linkId);
      expect(challenge.nonce).toMatch(/^0x[0-9a-f]{32}$/);

      // Sign typed data with registered receiver account
      const typedData = buildReadActivityTypedData(challenge);
      const signature = await receiverAccount.signTypedData(typedData);

      // Verification with registered signer succeeds
      const checkValid = await verifyReadActivitySignature({
        linkId: challenge.linkId,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
        signature,
        expectedSigner: receiverAccount.address,
      });
      expect(checkValid.valid).toBe(true);

      // Replay of same nonce fails
      const replayCheck = await verifyReadActivitySignature({
        linkId: challenge.linkId,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
        signature,
        expectedSigner: receiverAccount.address,
      });
      expect(replayCheck.valid).toBe(false);
      expect(replayCheck.reason).toContain('already been consumed');

      // Signature from a different wallet is rejected
      const newChallenge = issueReadActivityChallenge(payload.linkId);
      const wrongTypedData = buildReadActivityTypedData(newChallenge);
      const wrongSignature = await otherAccount.signTypedData(wrongTypedData);

      const wrongSignerCheck = await verifyReadActivitySignature({
        linkId: newChallenge.linkId,
        nonce: newChallenge.nonce,
        expiresAt: newChallenge.expiresAt,
        signature: wrongSignature,
        expectedSigner: receiverAccount.address,
      });
      expect(wrongSignerCheck.valid).toBe(false);
      expect(wrongSignerCheck.reason).toContain('does not match link signer');

      // Expired challenge is rejected
      const expiredCheck = await verifyReadActivitySignature({
        linkId: newChallenge.linkId,
        nonce: newChallenge.nonce,
        expiresAt: (Math.floor(Date.now() / 1000) - 10).toString(),
        signature: wrongSignature,
        expectedSigner: receiverAccount.address,
        requireStoredNonce: false,
      });
      expect(expiredCheck.valid).toBe(false);
      expect(expiredCheck.reason).toContain('expired');
    });

    it('Stores link revocations and CCTP transfer state transitions in the same events store', async () => {
      const store = new InMemoryEventStore();

      // Record link revocation
      const revEvent = await store.recordEvent({
        linkId: 'revocable-link-1',
        eventType: 'LINK_REVOCATION',
        status: 'REVOKED',
        simulated: false,
        payerAddress: '0x0000000000000000000000000000000000000000',
        receiverVault: receiverAccount.address,
        amount: '0.00',
        asset: 'USDC',
        sourceChainId: 0,
        sourceChainName: 'Network',
        errorMessage: 'Link revocable-link-1 revoked by receiver',
      });

      expect(revEvent.eventType).toBe('LINK_REVOCATION');
      expect(revEvent.status).toBe('REVOKED');

      // Record CCTP transfer states: BURN_PENDING -> ATTESTED -> MINTED
      const burnEvent = await store.recordEvent({
        id: 'cctp_0xburn123_BURN_PENDING',
        linkId: 'cctp-link-1',
        eventType: 'CCTP_TRANSFER_STATE',
        status: 'BURN_PENDING',
        simulated: false,
        payerAddress: receiverAccount.address,
        receiverVault: otherAccount.address,
        amount: '50.00',
        asset: 'USDC',
        sourceChainId: 84532,
        sourceChainName: 'Base Sepolia',
        destinationChainId: 421614,
        txHash: '0xburn123',
      });

      const mintEvent = await store.recordEvent({
        id: 'cctp_0xburn123_MINTED',
        linkId: 'cctp-link-1',
        eventType: 'CCTP_TRANSFER_STATE',
        status: 'MINTED',
        simulated: false,
        payerAddress: receiverAccount.address,
        receiverVault: otherAccount.address,
        amount: '50.00',
        asset: 'USDC',
        sourceChainId: 84532,
        sourceChainName: 'Base Sepolia',
        destinationChainId: 421614,
        txHash: '0xmint456',
      });

      expect(burnEvent.eventType).toBe('CCTP_TRANSFER_STATE');
      expect(burnEvent.status).toBe('BURN_PENDING');
      expect(mintEvent.status).toBe('MINTED');

      const cctpEvents = await store.getEvents({ linkId: 'cctp-link-1' });
      expect(cctpEvents.length).toBe(2);
      expect(cctpEvents[0].status).toBe('MINTED');
      expect(cctpEvents[1].status).toBe('BURN_PENDING');
    });
  });
});
