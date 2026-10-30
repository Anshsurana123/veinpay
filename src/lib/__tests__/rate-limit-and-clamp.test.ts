import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkRateLimit,
  clearRateLimitsForTesting,
  getClientIp,
} from '@/lib/security/rate-limit';
import {
  buildScanCacheKey,
  clampCrawlSettings,
  clearScanAndGeminiCaches,
  getCachedGeminiSummary,
  getCachedScanResult,
  setCachedGeminiSummary,
  setCachedScanResult,
} from '@/lib/security/scan-cache';
import {
  generateAigiForensicReceipt,
  maybeEnrichReceiptWithGemini,
} from '@/lib/aigi/verdict';
import { runVeinPayFirewallTraversal } from '@/lib/graph/engine';
import { AUTHORITATIVE_DEFAULT_POLICY, runFullScan } from '@/lib/graph/full-scan';
import { computePolicyKeccak256 } from '@/lib/links/canonical';

describe('Issue 11: Rate Limiting, Server-Clamped Crawl Settings, and Caching', () => {
  beforeEach(() => {
    clearRateLimitsForTesting();
    clearScanAndGeminiCaches();
    delete process.env.ENABLE_GEMINI_NARRATION;
  });

  describe('Server-Side Crawl Settings Clamping', () => {
    it('clamps excessive client-supplied crawl settings to hard server maxima', () => {
      const clamped = clampCrawlSettings({
        topFundersPerVertex: 1000,
        maxApiCallsPerScan: 500,
        rateLimitRps: 100,
        crawlTimeoutMs: 600000,
        maxMainnetUsdCap: 10000,
      });

      expect(clamped.topFundersPerVertex).toBeLessThanOrEqual(10);
      expect(clamped.maxApiCallsPerScan).toBeLessThanOrEqual(50);
      expect(clamped.rateLimitRps).toBeLessThanOrEqual(5);
      expect(clamped.crawlTimeoutMs).toBeLessThanOrEqual(15000);
      expect(clamped.maxMainnetUsdCap).toBeLessThanOrEqual(50);
    });

    it('preserves valid within-range client crawl settings', () => {
      const clamped = clampCrawlSettings({
        topFundersPerVertex: 3,
        maxApiCallsPerScan: 20,
        rateLimitRps: 2,
        crawlTimeoutMs: 5000,
        maxMainnetUsdCap: 3,
      });

      expect(clamped.topFundersPerVertex).toBe(3);
      expect(clamped.maxApiCallsPerScan).toBe(20);
      expect(clamped.rateLimitRps).toBe(2);
      expect(clamped.crawlTimeoutMs).toBe(5000);
      expect(clamped.maxMainnetUsdCap).toBe(3);
    });

    it('falls back to secure defaults on empty or undefined input', () => {
      const clamped = clampCrawlSettings(null);
      expect(clamped.topFundersPerVertex).toBe(5);
      expect(clamped.maxApiCallsPerScan).toBe(40);
      expect(clamped.rateLimitRps).toBe(3);
      expect(clamped.crawlTimeoutMs).toBe(10000);
      expect(clamped.maxMainnetUsdCap).toBe(5);
    });
  });

  describe('Per-IP Rate Limiting', () => {
    it('allows requests within limit and decrements remaining counter', async () => {
      const res1 = await checkRateLimit('test-route', '192.168.1.1', {
        limit: 3,
        windowSeconds: 60,
      });
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);

      const res2 = await checkRateLimit('test-route', '192.168.1.1', {
        limit: 3,
        windowSeconds: 60,
      });
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(1);

      const res3 = await checkRateLimit('test-route', '192.168.1.1', {
        limit: 3,
        windowSeconds: 60,
      });
      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(0);

      const res4 = await checkRateLimit('test-route', '192.168.1.1', {
        limit: 3,
        windowSeconds: 60,
      });
      expect(res4.allowed).toBe(false);
      expect(res4.remaining).toBe(0);
      expect(res4.resetSeconds).toBeGreaterThan(0);
    });

    it('isolates buckets by IP and route key', async () => {
      const resA = await checkRateLimit('route-A', '10.0.0.1', { limit: 1 });
      expect(resA.allowed).toBe(true);

      const resB = await checkRateLimit('route-B', '10.0.0.1', { limit: 1 });
      expect(resB.allowed).toBe(true);

      const resOtherIp = await checkRateLimit('route-A', '10.0.0.2', { limit: 1 });
      expect(resOtherIp.allowed).toBe(true);

      // Re-query route-A on 10.0.0.1 -> blocked
      const resABlocked = await checkRateLimit('route-A', '10.0.0.1', { limit: 1 });
      expect(resABlocked.allowed).toBe(false);
    });

    it('extracts IP from request headers properly', () => {
      const req1 = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' },
      });
      expect(getClientIp(req1)).toBe('203.0.113.195');

      const req2 = new Request('http://localhost', {
        headers: { 'x-real-ip': '198.51.100.4' },
      });
      expect(getClientIp(req2)).toBe('198.51.100.4');

      const req3 = new Request('http://localhost');
      expect(getClientIp(req3)).toBe('127.0.0.1');
    });
  });

  describe('Scan Caching by (address, chain, policyHash)', () => {
    it('caches scan results for 60s and expires properly', () => {
      const scan = runVeinPayFirewallTraversal({
        targetWallet: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
        merchantWallet: '0x1111111111111111111111111111111111111111',
        policy: AUTHORITATIVE_DEFAULT_POLICY,
      });
      const receipt = generateAigiForensicReceipt(scan);
      const policyHash = computePolicyKeccak256(AUTHORITATIVE_DEFAULT_POLICY);
      const key = buildScanCacheKey(scan.targetWallet, 42161, policyHash);

      const now = 1000000;
      setCachedScanResult(key, { scan, receipt }, 60_000, now);

      // Cache hit at +30s
      const hit = getCachedScanResult(key, now + 30_000);
      expect(hit).not.toBeNull();
      expect(hit?.scan.targetWallet).toBe(scan.targetWallet);

      // Cache expired at +61s
      const expired = getCachedScanResult(key, now + 61_000);
      expect(expired).toBeNull();
    });

    it('runFullScan uses scan cache on repeated identical queries', async () => {
      const params = {
        targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
        merchantWallet: '0x1111111111111111111111111111111111111111',
        chainId: 42161,
        policy: AUTHORITATIVE_DEFAULT_POLICY,
      };

      const res1 = await runFullScan(params);
      expect(res1.scan.verdict).toBe('INTERCEPTED_TAINT');

      // Second scan should return the cached scan with the identical cryptographicAuditHash
      const res2 = await runFullScan(params);
      expect(res2.receipt.cryptographicAuditHash).toBe(res1.receipt.cryptographicAuditHash);
      expect(res2.scan.verdict).toBe('INTERCEPTED_TAINT');
    });
  });

  describe('Gemini Gate and Summary Caching', () => {
    it('skips Gemini when ENABLE_GEMINI_NARRATION is not true', async () => {
      process.env.GEMINI_API_KEY = 'fake-key-for-test';
      delete process.env.ENABLE_GEMINI_NARRATION;

      const scan = runVeinPayFirewallTraversal({
        targetWallet: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
        merchantWallet: '0x1111111111111111111111111111111111111111',
        policy: AUTHORITATIVE_DEFAULT_POLICY,
      });
      const receipt = generateAigiForensicReceipt(scan);

      const enriched = await maybeEnrichReceiptWithGemini(receipt);
      expect(enriched.geminiExecutiveSummary).toBeNull();
    });

    it('serves cached Gemini summary without spending API credits when summary is in cache', async () => {
      process.env.ENABLE_GEMINI_NARRATION = 'true';
      process.env.GEMINI_API_KEY = 'fake-key-for-test';

      const scan = runVeinPayFirewallTraversal({
        targetWallet: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
        merchantWallet: '0x1111111111111111111111111111111111111111',
        policy: AUTHORITATIVE_DEFAULT_POLICY,
      });
      const receipt = generateAigiForensicReceipt(scan);

      // Pre-seed cache with summary
      const cachedSummaryText =
        'Verified clean compliance verdict: target wallet shows 0 taint hits over 3 hops.';
      setCachedGeminiSummary(receipt.cryptographicAuditHash, cachedSummaryText);

      expect(getCachedGeminiSummary(receipt.cryptographicAuditHash)).toBe(
        cachedSummaryText
      );

      const enriched = await maybeEnrichReceiptWithGemini(receipt);
      expect(enriched.geminiExecutiveSummary).toBe(cachedSummaryText);
      expect(enriched.geminiModelUsed).toBe('cached');
    });
  });
});
