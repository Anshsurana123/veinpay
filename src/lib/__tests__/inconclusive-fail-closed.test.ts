import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';
import { crawlLiveAddressAndScan } from '@/lib/graph/live-crawler';
import { generateAigiForensicReceipt } from '@/lib/aigi/verdict';
import type { FirewallPolicyConfig } from '@/types/veilpay';

describe('Issue 7: Unknown wallets fail closed with INCONCLUSIVE', () => {
  const originalEnv = process.env.ETHERSCAN_API_KEY;

  afterEach(() => {
    process.env.ETHERSCAN_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  const baseBlockPolicy: FirewallPolicyConfig = {
    firewallEnabled: true,
    maxHops: 3,
    cleanLinkEnabled: true,
    unbundleEnabled: true,
    socketAutoBridgeEnabled: true,
    sybilBlockThreshold: 10,
    inconclusivePolicy: 'BLOCK',
  };

  const baseWarnPolicy: FirewallPolicyConfig = {
    ...baseBlockPolicy,
    inconclusivePolicy: 'WARN',
  };

  const unseededWallet = '0x1111111111111111111111111111111111111111';

  it('Returns INCONCLUSIVE and locks gates when ETHERSCAN_API_KEY is unset and policy is BLOCK', async () => {
    delete process.env.ETHERSCAN_API_KEY;

    const result = await crawlLiveAddressAndScan({
      targetWallet: unseededWallet,
      merchantWallet: '0x2222222222222222222222222222222222222222',
      chainId: 1,
      policy: baseBlockPolicy,
    });

    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.socketUnlocked).toBe(false);
    expect(result.vaultUriUnlocked).toBe(false);
    expect(result.inconclusiveReason).toContain('ETHERSCAN_API_KEY is unset');

    const receipt = generateAigiForensicReceipt(result);
    expect(receipt.verdictStatus).toBe('INCONCLUSIVE');
    expect(receipt.badgeTitle).toBe('LINEAGE INCONCLUSIVE: BLOCKED BY POLICY');
    expect(receipt.inconclusiveReason).toBe(result.inconclusiveReason);
    expect(receipt.deterministicNarrative).toContain('locked (fail-closed)');
  });

  it('Returns INCONCLUSIVE with unlocked gates when policy is WARN', async () => {
    delete process.env.ETHERSCAN_API_KEY;

    const result = await crawlLiveAddressAndScan({
      targetWallet: unseededWallet,
      merchantWallet: '0x2222222222222222222222222222222222222222',
      chainId: 1,
      policy: baseWarnPolicy,
    });

    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.socketUnlocked).toBe(true);
    expect(result.vaultUriUnlocked).toBe(true);

    const receipt = generateAigiForensicReceipt(result);
    expect(receipt.badgeTitle).toBe('LINEAGE INCONCLUSIVE: WARNING ADVISORY');
    expect(receipt.deterministicNarrative).toContain('unlocked with warning');
  });

  it('Returns INCONCLUSIVE when crawl is truncated due to budget/timeout limits', () => {
    const scan = runVeilPayFirewallTraversal({
      targetWallet: unseededWallet,
      merchantWallet: '0x2222222222222222222222222222222222222222',
      policy: baseBlockPolicy,
      crawlTruncated: true,
      inconclusiveReason: 'Crawl truncated: reached maximum API query or execution timeout budget',
    });

    expect(scan.verdict).toBe('INCONCLUSIVE');
    expect(scan.socketUnlocked).toBe(false);
    expect(scan.inconclusiveReason).toContain('Crawl truncated');

    const receipt = generateAigiForensicReceipt(scan);
    expect(receipt.badgeTitle).toBe('LINEAGE INCONCLUSIVE: BLOCKED BY POLICY');
  });

  it('Direct engine invocation with isInconclusive=true blocks or warns according to policy', () => {
    const blockedScan = runVeilPayFirewallTraversal({
      targetWallet: unseededWallet,
      policy: baseBlockPolicy,
      isInconclusive: true,
      inconclusiveReason: 'GoPlus API request failed or timed out',
    });
    expect(blockedScan.verdict).toBe('INCONCLUSIVE');
    expect(blockedScan.socketUnlocked).toBe(false);

    const warnedScan = runVeilPayFirewallTraversal({
      targetWallet: unseededWallet,
      policy: baseWarnPolicy,
      isInconclusive: true,
      inconclusiveReason: 'GoPlus API request failed or timed out',
    });
    expect(warnedScan.verdict).toBe('INCONCLUSIVE');
    expect(warnedScan.socketUnlocked).toBe(true);
  });

  it('Seeded clean wallets still evaluate to VERIFIED_CLEAN even if API key is unset', async () => {
    delete process.env.ETHERSCAN_API_KEY;

    // 0x4F2a9c117034e8B1200499A1c3f88200000188E1 is seeded clean wallet (Clean Arbitrum Whale)
    const seededCleanWallet = '0x4F2a9c117034e8B1200499A1c3f88200000188E1';
    const result = await crawlLiveAddressAndScan({
      targetWallet: seededCleanWallet,
      merchantWallet: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      chainId: 42161,
      policy: baseBlockPolicy,
    });

    expect(result.verdict).toBe('VERIFIED_CLEAN');
    expect(result.socketUnlocked).toBe(true);
  });
});
