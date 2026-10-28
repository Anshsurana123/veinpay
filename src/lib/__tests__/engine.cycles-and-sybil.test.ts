import { describe, expect, it } from 'vitest';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';

describe('Case 2 & Case 3: Cyclic Graph Loops, Self-Transfers & 24-Wallet Sybil Collapse', () => {
  const p3 = '0x5eb1a800112233445566778899aAbb0000010014';

  it('Prevents infinite loops on cyclic wash rings (A -> B -> C -> A) and self-transfers (A -> A)', () => {
    const res = runVeilPayFirewallTraversal({
      targetWallet: p3,
      policy: {
        firewallEnabled: true,
        maxHops: 4,
        cleanLinkEnabled: true,
        unbundleEnabled: true,
        socketAutoBridgeEnabled: true,
        sybilBlockThreshold: 10,
      },
    });

    expect(res.cyclicLoopDetected).toBe(true);
    expect(res.selfTransferDetected).toBe(true);
    expect(res.detectedCyclePaths.length).toBeGreaterThanOrEqual(1);
    expect(res.executionTimeMs).toBeLessThan(100);
  });

  it('Collapses 24 sybil sibling wallets to shared ancestor 0xB055...9999 and blocks when threshold <= 24', () => {
    const blocked = runVeilPayFirewallTraversal({
      targetWallet: p3,
      policy: {
        firewallEnabled: true,
        maxHops: 3,
        cleanLinkEnabled: true,
        unbundleEnabled: true,
        socketAutoBridgeEnabled: true,
        sybilBlockThreshold: 10,
      },
    });

    expect(blocked.sybilClusterSize).toBe(24);
    expect(blocked.sybilRootFunder?.toLowerCase()).toBe(
      '0xb055000000000000000000000000000000019999'
    );
    expect(blocked.verdict).toBe('INTERCEPTED_SYBIL');
    expect(blocked.socketUnlocked).toBe(false);

    // When threshold is raised above 24 (e.g. 30), returns WARNING_SYBIL (amber warning)
    const warned = runVeilPayFirewallTraversal({
      targetWallet: p3,
      policy: {
        firewallEnabled: true,
        maxHops: 3,
        cleanLinkEnabled: true,
        unbundleEnabled: true,
        socketAutoBridgeEnabled: true,
        sybilBlockThreshold: 30,
      },
    });
    expect(warned.verdict).toBe('WARNING_SYBIL');
    expect(warned.socketUnlocked).toBe(true);
  });
});
