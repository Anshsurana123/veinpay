import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryEventStore } from '@/lib/events/store';
import { verifyOnChainSettlementReceipt } from '@/lib/events/verify-receipt';
import {
  clearLinkStoreForTests,
  storeSignedLinkRecord,
  verifyManageTokenForLink,
} from '@/lib/links';
import { createPaymentLinkPayload } from '@/lib/links/eip712';
import { encodeSignedLinkPayloadToBase64Url } from '@/lib/links/canonical';

describe('Issue 8: Server-backed Activity feed & On-chain receipt verification', () => {
  beforeEach(() => {
    clearLinkStoreForTests();
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

  describe('Receiver Access Auth via manageToken', () => {
    it('Requires valid manageToken to access private receiver link feed', () => {
      const payload = createPaymentLinkPayload({
        handle: 'secure-receiver',
        amount: '100.00',
        asset: 'USDC',
        destinationChainId: 8453,
        settlementMode: 'EVM_SOCKET',
        vaultAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        signer: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
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
      const { manageToken } = storeSignedLinkRecord({
        payload,
        encodedPayload: canonicalEncoded,
        signature: '0x1234',
        trustLevel: 'SIGNED_UNPROVEN',
      });

      expect(manageToken).toBeDefined();

      // Valid token matches
      const isValid = verifyManageTokenForLink(payload.linkId, manageToken);
      expect(isValid).toBe(true);

      // Wrong token fails
      const isWrongValid = verifyManageTokenForLink(
        payload.linkId,
        'wrong_token_123'
      );
      expect(isWrongValid).toBe(false);

      // Missing token fails
      const isMissingValid = verifyManageTokenForLink(payload.linkId, null);
      expect(isMissingValid).toBe(false);
    });
  });
});
