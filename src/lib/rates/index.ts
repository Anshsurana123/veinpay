export interface SpotRates {
  ETH: number;
  BTC: number;
  XMR: number;
  USDC: number;
  USDT: number;
}

export interface SpotRatesPayload {
  rates: SpotRates;
  fetchedAt: string; // ISO-8601
  expiresAt: string; // ISO-8601 (fetchedAt + 30s)
  source: string;
}

const RATES_TTL_MS = 30 * 1000; // 30 seconds cache TTL

let cachedRates: SpotRatesPayload | null = null;
let mockRates: SpotRatesPayload | null = null;

export function setMockRatesForTests(mock: SpotRatesPayload | null): void {
  mockRates = mock;
}

export function clearRatesCacheForTests(): void {
  cachedRates = null;
  mockRates = null;
}

/**
 * Server-side spot price fetcher for ETH, BTC, XMR, USDC, and USDT.
 * Enforces a 30s cache TTL and 3.5s abort timeout.
 * NEVER falls back to constants on failure.
 */
export async function getLiveSpotRates(
  forceRefresh = false
): Promise<SpotRatesPayload> {
  if (mockRates) {
    return mockRates;
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    cachedRates &&
    now < new Date(cachedRates.expiresAt).getTime()
  ) {
    return cachedRates;
  }

  // 1. Primary Oracle: CoinGecko Free API
  try {
    const cgUrl =
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,monero,usd-coin,tether&vs_currencies=usd';
    const res = await fetch(cgUrl, {
      signal: AbortSignal.timeout(3500),
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd?: number }>;
      const eth = data.ethereum?.usd;
      const btc = data.bitcoin?.usd;
      const xmr = data.monero?.usd;

      if (
        typeof eth === 'number' &&
        eth > 0 &&
        typeof btc === 'number' &&
        btc > 0 &&
        typeof xmr === 'number' &&
        xmr > 0
      ) {
        const fetchedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + RATES_TTL_MS).toISOString();
        cachedRates = {
          rates: {
            ETH: eth,
            BTC: btc,
            XMR: xmr,
            USDC: Number(data['usd-coin']?.usd ?? 1.0),
            USDT: Number(data.tether?.usd ?? 1.0),
          },
          fetchedAt,
          expiresAt,
          source: 'CoinGecko Live API',
        };
        return cachedRates;
      }
    }
  } catch {
    // Fall through to secondary oracle
  }

  // 2. Secondary Oracle: CryptoCompare Public API
  try {
    const ccUrl =
      'https://min-api.cryptocompare.com/data/pricemulti?fsyms=ETH,BTC,XMR,USDC,USDT&tsyms=USD';
    const res = await fetch(ccUrl, {
      signal: AbortSignal.timeout(3500),
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, { USD?: number }>;
      const eth = data.ETH?.USD;
      const btc = data.BTC?.USD;
      const xmr = data.XMR?.USD;

      if (
        typeof eth === 'number' &&
        eth > 0 &&
        typeof btc === 'number' &&
        btc > 0 &&
        typeof xmr === 'number' &&
        xmr > 0
      ) {
        const fetchedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + RATES_TTL_MS).toISOString();
        cachedRates = {
          rates: {
            ETH: eth,
            BTC: btc,
            XMR: xmr,
            USDC: Number(data.USDC?.USD ?? 1.0),
            USDT: Number(data.USDT?.USD ?? 1.0),
          },
          fetchedAt,
          expiresAt,
          source: 'CryptoCompare Live API',
        };
        return cachedRates;
      }
    }
  } catch {
    // Fall through
  }

  // If both live oracles fail, DO NOT FALL BACK TO HARDCODED NUMBERS!
  // Throw an explicit error to disable ETH/BTC/XMR flows safely.
  throw new Error(
    'Spot price oracle unavailable. Failed to fetch live exchange rates for ETH, BTC, or XMR.'
  );
}
