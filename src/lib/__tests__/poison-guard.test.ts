import { describe, expect, it } from 'vitest';
import { evaluateOutboundPoisonRisk } from '@/lib/graph/poison-guard';
import { DEMO_CAKE_VAULT_ADDRESSES } from '@/lib/demo-fixtures';

describe('Case 4: PoisonGraph Outbound Lookalike & Dust-Factory Guard', () => {
  it('Sub-Case 4A: Intercepts poisoned vanity clone (0x71C894a1...489B) with 6-char prefix, 4-char suffix, and 4,210 dust edges', () => {
    const res = evaluateOutboundPoisonRisk({
      candidateInput: '0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B',
    });

    expect(res.verdict).toBe('INTERCEPTED_POISONING');
    expect(res.matchingPrefixChars).toBe(6); // "0x71C8"
    expect(res.matchingSuffixChars).toBe(4); // "489B"
    expect(res.forgedMiddleChars).toBe(32);
    expect(res.priorLegitimateInteractions).toBe(0);
    expect(res.dustOutDegree).toBe(4210);
    expect(res.matchedTrustedContact?.address).toBe(
      '0x71C8f3b98812ABC90123456789ABcdef0003489B'
    );
    expect(res.charDiffGrid).toHaveLength(42);
  });

  it('Clears exact verified trusted contact (0x71C8f3b9...489B)', () => {
    const res = evaluateOutboundPoisonRisk({
      candidateInput: '0x71C8f3b98812ABC90123456789ABcdef0003489B',
    });
    expect(res.verdict).toBe('VERIFIED_TRUSTED_CONTACT');
    expect(res.priorLegitimateInteractions).toBe(4);
    expect(res.dustOutDegree).toBe(0);
  });

  it('Sub-Case 4B: Clears brand-new legitimate recipient (0x22A9c001...771C) without false-positive blocking', () => {
    const res = evaluateOutboundPoisonRisk({
      candidateInput: '0x22A9c0018834dEf011223344556677880004771C',
    });
    expect(res.verdict).toBe('VERIFIED_FIRST_TIME_RECIPIENT');
    expect(res.dustOutDegree).toBe(0);
  });

  it('Sub-Case 4C: Detects wrong-network addresses (BIP-352 sp1... in EVM field) and malformed strings', () => {
    const wrongNet = evaluateOutboundPoisonRisk({
      candidateInput: DEMO_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
      expectedMode: 'EVM_SOCKET',
    });
    expect(wrongNet.verdict).toBe('INVALID_ADDRESS_OR_NETWORK_MISMATCH');
    expect(wrongNet.detectedProtocol).toBe('BTC_SILENT_PAYMENT');
    expect(wrongNet.validationError).toContain('Network Mismatch');

    const badChecksum = evaluateOutboundPoisonRisk({
      candidateInput: '0x742d35cc6634C0532925a3b844Bc454e4438f44e', // 'cc' instead of 'Cc'
      expectedMode: 'EVM_SOCKET',
    });
    expect(badChecksum.verdict).toBe('INVALID_ADDRESS_OR_NETWORK_MISMATCH');
    expect(badChecksum.checksumFixSuggestion).toBe(
      '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
    );
  });
});
