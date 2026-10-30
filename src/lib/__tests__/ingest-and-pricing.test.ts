import { describe, expect, it, vi, beforeEach } from 'vitest';
import { computeTransferPricing, NATIVE_SYMBOL_BY_CHAIN } from '@/lib/ingest/pricing';
import { fetchEtherscanTransfers, clearEtherscanIngestCacheForTests } from '@/lib/ingest/providers/etherscan';
import { crawlLiveAddressAndScan } from '@/lib/graph/live-crawler';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';
import type { FirewallPolicyConfig } from '@/types/veilpay';

const DEFAULT_POLICY: FirewallPolicyConfig = {
  firewallEnabled: true,
  maxHops: 3,
  cleanLinkEnabled: true,
  unbundleEnabled: true,
  socketAutoBridgeEnabled: true,
  sybilBlockThreshold: 10,
  inconclusivePolicy: 'BLOCK',
};

describe('P0-1 & P1-3 Live Ingest, Normalization & Pricing Suite', () => {
  beforeEach(() => {
    clearEtherscanIngestCacheForTests();
    vi.restoreAllMocks();
  });

  it('1. Correctly decodes 6-decimal USDC: 50,000 USDC is parsed as 50,000 (not dust) and priced at $1/token', () => {
    const rawUsdc = '50000000000'; // 50,000 * 10^6
    const pricing = computeTransferPricing({
      chainId: 1,
      tokenKind: 'erc20',
      rawSymbol: 'USDC',
      rawDecimals: '6',
      rawValueStr: rawUsdc,
      spotRates: { ETH: 2500, BTC: 60000, XMR: 150, USDC: 1, USDT: 1 },
    });

    expect(pricing.decimals).toBe(6);
    expect(pricing.amount).toBe(50000);
    expect(pricing.amountUsd).toBe(50000);
    expect(pricing.usdKnown).toBe(true);
    expect(pricing.isSpam).toBe(false);
  });

  it('2. Correctly prices 18-decimal DAI at $1/token, NOT as ETH spot rate', () => {
    const rawDai = '100000000000000000000'; // 100 DAI (18 decimals)
    const pricing = computeTransferPricing({
      chainId: 1,
      tokenKind: 'erc20',
      rawSymbol: 'DAI',
      rawDecimals: 18,
      rawValueStr: rawDai,
      spotRates: { ETH: 3000, BTC: 60000, XMR: 150, USDC: 1, USDT: 1 },
    });

    expect(pricing.decimals).toBe(18);
    expect(pricing.amount).toBe(100);
    // 100 DAI must be priced at $100, NOT 100 * $3000 = $300,000!
    expect(pricing.amountUsd).toBe(100);
    expect(pricing.usdKnown).toBe(true);
  });

  it('3. Prices Polygon native tokens as POL (not ETH)', () => {
    const rawPol = '10000000000000000000'; // 10 POL (18 decimals)
    const pricing = computeTransferPricing({
      chainId: 137, // Polygon
      tokenKind: 'native',
      rawValueStr: rawPol,
      spotRates: { ETH: 2500, BTC: 60000, XMR: 150, USDC: 1, USDT: 1 },
    });

    expect(pricing.symbol).toBe('POL');
    expect(pricing.decimals).toBe(18);
    expect(pricing.amount).toBe(10);
    // Must NOT be 10 * 2500 = $25,000
    expect(pricing.amountUsd).toBeLessThan(100);
    expect(pricing.usdKnown).toBe(true);
  });

  it('4. Classifies zero-value token transfers as spam', () => {
    const pricing = computeTransferPricing({
      chainId: 1,
      tokenKind: 'erc20',
      rawSymbol: 'SPAM_AIRDROP',
      rawDecimals: 18,
      rawValueStr: '0',
    });

    expect(pricing.amount).toBe(0);
    expect(pricing.isSpam).toBe(true);
  });

  it('5. Unpriced tokens are conservative: usdKnown=false, not marked as dust, taint propagates', () => {
    const rawUnknown = '1000000000000000000'; // 1 TOKEN
    const pricing = computeTransferPricing({
      chainId: 1,
      tokenKind: 'erc20',
      rawSymbol: 'RANDOM_COIN',
      rawDecimals: 18,
      rawValueStr: rawUnknown,
    });

    expect(pricing.usdKnown).toBe(false);
    expect(pricing.amountUsd).toBeNull();
    // Conservative: NOT marked as spam/dust so it can carry taint
    expect(pricing.isSpam).toBe(false);
  });

  it('6. Mock Etherscan: 50,000 USDC from known drainer triggers INTERCEPTED_TAINT (proves USDC is not dropped as dust)', async () => {
    const drainerAddress = '0xdead000000000000000000000000000000000001';
    const targetWallet = '0x1234567890123456789012345678901234567890';

    // Mock global fetch for Etherscan V2
    const originalFetch = global.fetch;
    const origKey = process.env.ETHERSCAN_API_KEY;

    try {
      process.env.ETHERSCAN_API_KEY = 'test-etherscan-key';

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('action=txlist&') && urlStr.includes('sort=asc')) {
          // First funder
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                status: '1',
                message: 'OK',
                result: [],
              }),
          });
        }
        if (urlStr.includes('action=txlist&') && urlStr.includes('sort=desc')) {
          // Native transactions
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                status: '1',
                message: 'OK',
                result: [],
              }),
          });
        }
        if (urlStr.includes('action=txlistinternal')) {
          // Internal txs
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                status: '1',
                message: 'OK',
                result: [],
              }),
          });
        }
        if (urlStr.includes('action=tokentx')) {
          // 50,000 USDC from drainer
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                status: '1',
                message: 'OK',
                result: [
                  {
                    hash: '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                    blockNumber: '19000000',
                    timeStamp: Math.floor(Date.now() / 1000).toString(),
                    from: drainerAddress,
                    to: targetWallet,
                    value: '50000000000', // 50,000 USDC (6 decimals)
                    tokenSymbol: 'USDC',
                    tokenDecimal: '6',
                    contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                    isError: '0',
                  },
                ],
              }),
          });
        }
        if (urlStr.includes('gopluslabs')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                code: 1,
                result: {
                  [targetWallet.toLowerCase()]: {
                    honeypot_related_address: '0',
                    phishing_activities: '0',
                    blacklists: '0',
                  },
                },
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: '1', result: [] }),
        });
      });

      const scan = await crawlLiveAddressAndScan({
        targetWallet,
        merchantWallet: '0x2222222222222222222222222222222222222222',
        chainId: 1,
        policy: DEFAULT_POLICY,
      });

      // 50,000 USDC from the drainer MUST NOT be dropped as dust!
      expect(scan.verdict).toBe('INTERCEPTED_TAINT');
      expect(scan.socketUnlocked).toBe(false);
      expect(scan.vaultUriUnlocked).toBe(false);
      expect(scan.taintHits).toBeGreaterThanOrEqual(1);
      expect(scan.edges.some((e) => e.attributes.token === 'USDC')).toBe(true);
      expect(scan.edges.some((e) => e.attributes.amount === 50000)).toBe(true);
    } finally {
      global.fetch = originalFetch;
      if (origKey !== undefined) process.env.ETHERSCAN_API_KEY = origKey;
      else delete process.env.ETHERSCAN_API_KEY;
    }
  });

  it('7. Internal transaction funding is detected and traversed into lineage', async () => {
    const safeContract = '0x0000000000000000000000000000000000000999';
    const targetWallet = '0x1234567890123456789012345678901234567890';

    const originalFetch = global.fetch;
    const origKey = process.env.ETHERSCAN_API_KEY;

    try {
      process.env.ETHERSCAN_API_KEY = 'test-etherscan-key';

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('action=txlistinternal')) {
          // Inbound internal tx funding of 5 ETH
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                status: '1',
                message: 'OK',
                result: [
                  {
                    hash: '0xinternal1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                    blockNumber: '19000001',
                    timeStamp: Math.floor(Date.now() / 1000).toString(),
                    from: safeContract,
                    to: targetWallet,
                    value: '5000000000000000000', // 5 ETH
                    isError: '0',
                  },
                ],
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: '1', result: [] }),
        });
      });

      const { transfers, coverage } = await fetchEtherscanTransfers({
        address: targetWallet,
        chainId: 1,
        apiKey: 'test-etherscan-key',
      });

      expect(coverage.internalTxQueried).toBe(true);
      const internalTransfer = transfers.find((t) => t.tokenKind === 'internal');
      expect(internalTransfer).toBeDefined();
      expect(internalTransfer?.amount).toBe(5);
      expect(internalTransfer?.from.toLowerCase()).toBe(safeContract.toLowerCase());
    } finally {
      global.fetch = originalFetch;
      if (origKey !== undefined) process.env.ETHERSCAN_API_KEY = origKey;
      else delete process.env.ETHERSCAN_API_KEY;
    }
  });

  it('8. Incomplete / truncated coverage fails closed with INCONCLUSIVE', () => {
    const scan = runVeilPayFirewallTraversal({
      targetWallet: '0x1234567890123456789012345678901234567890',
      merchantWallet: '0x2222222222222222222222222222222222222222',
      policy: DEFAULT_POLICY,
      coverage: {
        etherscanQueried: true,
        inboundComplete: false,
        truncatedReason: 'Rate limit or network drop interrupted crawl',
      },
    });

    expect(scan.verdict).toBe('INCONCLUSIVE');
    expect(scan.socketUnlocked).toBe(false);
    expect(scan.vaultUriUnlocked).toBe(false);
  });
});
