import { describe, expect, it } from 'vitest';
import { runVeinPayFirewallTraversal } from '@/lib/graph/engine';
import type { FirewallPolicyConfig, HopDepth } from '@/types/veinpay';

const basePolicy = (maxHops: HopDepth, firewallEnabled = true): FirewallPolicyConfig => ({
  firewallEnabled,
  maxHops,
  cleanLinkEnabled: true,
  unbundleEnabled: true,
  socketAutoBridgeEnabled: true,
  sybilBlockThreshold: 10,
});

describe('Case 1: Dynamic Hop-Depth Boundary Conditions (max_hops = 1..5)', () => {
  it('Persona 1 (0x4F2a...88E1 Clean Whale) passes across all hop depths 1..5', () => {
    const p1 = '0x4F2a9c117034e8B1200499A1c3f88200000188E1';
    for (const hops of [1, 2, 3, 4, 5] as HopDepth[]) {
      const res = runVeinPayFirewallTraversal({
        targetWallet: p1,
        policy: basePolicy(hops),
      });
      expect(res.verdict).toBe('VERIFIED_CLEAN');
      expect(res.socketUnlocked).toBe(true);
      expect(res.vaultUriUnlocked).toBe(true);
      expect(res.taintHits).toBe(0);
    }
  });

  it('Persona 2 (0x99B1...Dead 2-Hop Drainer) passes at Hop 1 with advisory and blocks at Hop 2, 3, 4, 5', () => {
    const p2 = '0x99B1c402881a77e3d90123456789aB00000FDead';

    // Hop 1 stops at Mule_1 (unmarked EOA) -> VERIFIED_CLEAN with shallowScanAdvisory
    const hop1 = runVeinPayFirewallTraversal({
      targetWallet: p2,
      policy: basePolicy(1),
    });
    expect(hop1.verdict).toBe('VERIFIED_CLEAN');
    expect(hop1.socketUnlocked).toBe(true);
    expect(hop1.taintHits).toBe(0);
    expect(hop1.shallowScanAdvisory).toBeTruthy();

    // Hop 2..5 reaches PinkDrainer (0xdead...0001) at Hop 2 -> INTERCEPTED_TAINT
    for (const hops of [2, 3, 4, 5] as HopDepth[]) {
      const res = runVeinPayFirewallTraversal({
        targetWallet: p2,
        policy: basePolicy(hops),
      });
      expect(res.verdict).toBe('INTERCEPTED_TAINT');
      expect(res.socketUnlocked).toBe(false);
      expect(res.vaultUriUnlocked).toBe(false);
      expect(res.minTaintHop).toBe(2);
      expect(res.taintHits).toBeGreaterThanOrEqual(1);
    }
  });

  it('Persona 4 (0x33C0...40b0 Deep 4-Hop Taint) passes at Hops 1, 2, 3 and dynamically blocks at Hops 4 & 5', () => {
    const p4 = '0x33C077112233445566778899aABbcC00000540b0';

    for (const hops of [1, 2, 3] as HopDepth[]) {
      const res = runVeinPayFirewallTraversal({
        targetWallet: p4,
        policy: basePolicy(hops),
      });
      expect(res.verdict).toBe('VERIFIED_CLEAN');
      expect(res.socketUnlocked).toBe(true);
      expect(res.taintHits).toBe(0);
    }

    for (const hops of [4, 5] as HopDepth[]) {
      const res = runVeinPayFirewallTraversal({
        targetWallet: p4,
        policy: basePolicy(hops),
      });
      expect(res.verdict).toBe('INTERCEPTED_TAINT');
      expect(res.socketUnlocked).toBe(false);
      expect(res.minTaintHop).toBe(4);
      expect(res.taintHits).toBeGreaterThanOrEqual(1);
    }
  });

  it('Master Firewall Toggle OFF returns ADVISORY_BYPASSED and unlocks SOCKET while still reporting topological taint', () => {
    const p2 = '0x99B1c402881a77e3d90123456789aB00000FDead';
    const bypassed = runVeinPayFirewallTraversal({
      targetWallet: p2,
      policy: basePolicy(3, false),
    });
    expect(bypassed.verdict).toBe('ADVISORY_BYPASSED');
    expect(bypassed.socketUnlocked).toBe(true);
    expect(bypassed.vaultUriUnlocked).toBe(true);
    expect(bypassed.taintHits).toBeGreaterThanOrEqual(1);
  });
});
