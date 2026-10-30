import { describe, expect, it } from 'vitest';
import { runVeinPayFirewallTraversal } from '@/lib/graph/engine';
import { generateAigiForensicReceipt } from '@/lib/aigi/verdict';

describe('AIGI Forensic Verdict & SHA-256 Cryptographic Commitment Determinism', () => {
  it('Produces identical SHA-256 cryptographicAuditHash across repeated runs for the same topology', () => {
    const policy = {
      firewallEnabled: true,
      maxHops: 3 as const,
      cleanLinkEnabled: true,
      unbundleEnabled: true,
      socketAutoBridgeEnabled: true,
      sybilBlockThreshold: 10,
    };

    const scanA = runVeinPayFirewallTraversal({
      targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
      policy,
    });
    const scanB = runVeinPayFirewallTraversal({
      targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
      policy,
    });

    const receiptA = generateAigiForensicReceipt(scanA);
    const receiptB = generateAigiForensicReceipt(scanB);

    expect(receiptA.verdictStatus).toBe('INTERCEPTED_TAINT');
    expect(receiptA.cryptographicAuditHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receiptA.cryptographicAuditHash).toBe(receiptB.cryptographicAuditHash);
    expect(receiptA.evidenceChain.length).toBeGreaterThanOrEqual(2);
    expect(receiptA.deterministicNarrative).toContain(
      '0xdead000000000000000000000000000000000001'
    );
  });
});
