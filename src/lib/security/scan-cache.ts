import type { FirewallScanResult, LiveCrawlSettings } from '@/types/veinpay';
import type { RunFullScanResult } from '@/lib/graph/full-scan';
import { getStorage } from '@/lib/storage';

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
  scan: FirewallScanResult;
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
  policyHash: string,
  graphSnapshotId = 'live'
): string {
  return `scan:${targetWallet.toLowerCase()}:${chainId}:${policyHash.toLowerCase()}:${graphSnapshotId}`;
}

export function getCachedScanResult(
  key: string,
  now = Date.now()
): (FirewallScanResult & { scan: FirewallScanResult }) | null {
  const entry = memoryScanCache.get(key);
  if (!entry) return null;
  if (now > entry.expiresAt) {
    memoryScanCache.delete(key);
    return null;
  }
  return Object.assign({}, entry.scan, { scan: entry.scan });
}

export async function getCachedScanResultAsync(
  key: string,
  now = Date.now()
): Promise<(FirewallScanResult & { scan: FirewallScanResult }) | null> {
  const local = getCachedScanResult(key, now);
  if (local) return local;

  const storage = getStorage();
  const stored = await storage.get<FirewallScanResult>(`scancache:${key}`);
  if (stored) {
    memoryScanCache.set(key, {
      scan: stored,
      expiresAt: now + 30_000,
    });
    return Object.assign({}, stored, { scan: stored });
  }
  return null;
}

export function setCachedScanResult(
  key: string,
  scanOrResult: FirewallScanResult | RunFullScanResult,
  ttlMs = 60_000,
  now = Date.now()
): void {
  const scan: FirewallScanResult =
    'scan' in scanOrResult ? (scanOrResult as RunFullScanResult).scan : (scanOrResult as FirewallScanResult);

  // Per P1-2: Never cache INCONCLUSIVE caused by upstream errors for more than ~5-10s
  const effectiveTtl =
    scan.verdict === 'INCONCLUSIVE' ? Math.min(ttlMs, 8_000) : ttlMs;

  memoryScanCache.set(key, {
    scan,
    expiresAt: now + effectiveTtl,
  });

  const storage = getStorage();
  void storage.set(`scancache:${key}`, scan, {
    exSeconds: Math.ceil(effectiveTtl / 1000),
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
