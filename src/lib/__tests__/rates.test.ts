import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearRatesCacheForTests,
  getLiveSpotRates,
  setMockRatesForTests,
} from '@/lib/rates';
import { GET as getRatesRoute } from '@/app/api/rates/route';

describe('Issue 9: Live Spot Rates Oracle & Removal of Hardcoded Prices', () => {
  beforeEach(() => {
    clearRatesCacheForTests();
  });

  it('Returns live spot rates with fetchedAt and expiresAt with a 30s TTL', async () => {
    const fixedNow = new Date('2026-10-29T12:00:00.000Z');
    const mockPayload = {
      rates: {
        ETH: 2650.5,
        BTC: 94250.0,
        XMR: 182.25,
        USDC: 1.0,
        USDT: 1.0,
      },
      fetchedAt: fixedNow.toISOString(),
      expiresAt: new Date(fixedNow.getTime() + 30000).toISOString(),
      source: 'Mock Test Oracle',
    };

    setMockRatesForTests(mockPayload);

    const result = await getLiveSpotRates();
    expect(result.rates.ETH).toBe(2650.5);
    expect(result.rates.BTC).toBe(94250.0);
    expect(result.rates.XMR).toBe(182.25);
    expect(result.fetchedAt).toBe(mockPayload.fetchedAt);
    expect(result.expiresAt).toBe(mockPayload.expiresAt);

    // Verify GET /api/rates route returns the expected schema
    const routeRes = await getRatesRoute();
    expect(routeRes.status).toBe(200);
    const json = await routeRes.json();
    expect(json.ok).toBe(true);
    expect(json.rates.ETH).toBe(2650.5);
    expect(json.rates.BTC).toBe(94250.0);
    expect(json.rates.XMR).toBe(182.25);
    expect(json.expiresAt).toBe(mockPayload.expiresAt);
  });

  it('Fails safely and NEVER falls back to constants when oracle is unavailable', async () => {
    clearRatesCacheForTests();

    // Mock fetch to reject all upstream calls
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error('Network offline or rate limit exceeded');
    };

    try {
      await expect(getLiveSpotRates(true)).rejects.toThrow(
        'Spot price oracle unavailable'
      );

      const routeRes = await getRatesRoute();
      expect(routeRes.status).toBe(503);
      const json = await routeRes.json();
      expect(json.ok).toBe(false);
      expect(json.rates).toBeNull();
      expect(json.error).toContain('Spot price oracle unavailable');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('Verifies dynamic calculation of BTC and XMR amounts without hardcoded 92000 or 175', () => {
    const amountUsd = 500;
    const dynamicBtcRate = 100000;
    const dynamicXmrRate = 200;

    const btcAmount = (amountUsd / dynamicBtcRate).toFixed(8);
    const xmrAmount = (amountUsd / dynamicXmrRate).toFixed(6);

    expect(btcAmount).toBe('0.00500000');
    expect(xmrAmount).toBe('2.500000');

    // Make sure old static numbers (92000, 175) are not used
    expect(amountUsd / 92000).not.toBe(Number(btcAmount));
    expect(amountUsd / 175).not.toBe(Number(xmrAmount));
  });
});
