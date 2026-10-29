import type { LiveCrawlSettings } from '@/types/veilpay';
import type { RunFullScanResult } from '@/lib/graph/full-scan';

// Hard server maxima (env-configurable with sensible production defaults)
export function clampCrawlSettings(
  input?: Partial<LiveCrawlSettings> | null
): LiveCrawlSettings {
  const maxTopFunders = Number(process.env.MAX_CRAWL_TOP_FUNDERS || '10');
  const maxApiCalls = Number(process.env.MAX_CRAWL_API_CALLS || '50');
  const maxRps = Number(process.env.MAX_CRAWL_RPS || '5');
  const maxTimeoutMs = Number(process.env.MAX_CRAWL_TIMEOUT_MS || '15000');
  const maxUsdCap = Number(process.env.MAX_MAINNET_USD_CAP || '50');

  return {
    topFundersPerVertex: Math.min(
      Math.max(1, Number(input?.topFundersPerVertex ?? 5)),
      maxTopFunders
    ),
    maxApiCallsPerScan: Math.min(
      Math.max(1, Number(input?.maxApiCallsPerScan ?? 40)),
      maxApiCalls
    ),
    rateLimitRps: Math.min(
      Math.max(1, Number(input?.rateLimitRps ?? 3)),
      maxRps
    ),
    crawlTimeoutMs: Math.min(
      Math.max(1000, Number(input?.crawlTimeoutMs ?? 10000)),
      maxTimeoutMs
    ),
    maxMainnetUsdCap: Math.min(
      Math.max(1, Number(input?.maxMainnetUsdCap ?? 5)),
      maxUsdCap
    ),
  };
}

interface ScanCacheEntry {
  result: RunFullScanResult;
  expiresAt: number;
}

const memoryScanCache = new Map<string, ScanCacheEntry>();
const memoryGeminiSummaryCache = new Map<string, { summary: string; expiresAt: number }>();

export function clearScanAndGeminiCaches(): void {
  memoryScanCache.clear();
  memoryGeminiSummaryCache.clear();
}

export function buildScanCacheKey(
  targetWallet: string,
  chainId: number,
  policyHash: string
): string {
  return `scan:${targetWallet.toLowerCase()}:${chainId}:${policyHash.toLowerCase()}`;
}

export function getCachedScanResult(
  key: string,
  now = Date.now()
): RunFullScanResult | null {
  const entry = memoryScanCache.get(key);
  if (!entry) return null;
  if (now > entry.expiresAt) {
    memoryScanCache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedScanResult(
  key: string,
  result: RunFullScanResult,
  ttlMs = 60_000,
  now = Date.now()
): void {
  memoryScanCache.set(key, {
    result,
    expiresAt: now + ttlMs,
  });
}

export function getCachedGeminiSummary(
  receiptHash: string,
  now = Date.now()
): string | null {
  const key = `gemini:summary:${receiptHash.toLowerCase()}`;
  const entry = memoryGeminiSummaryCache.get(key);
  if (!entry) return null;
  if (now > entry.expiresAt) {
    memoryGeminiSummaryCache.delete(key);
    return null;
  }
  return entry.summary;
}

export function setCachedGeminiSummary(
  receiptHash: string,
  summary: string,
  ttlMs = 300_000, // 5 min cache for Gemini summary
  now = Date.now()
): void {
  const key = `gemini:summary:${receiptHash.toLowerCase()}`;
  memoryGeminiSummaryCache.set(key, {
    summary,
    expiresAt: now + ttlMs,
  });
}
