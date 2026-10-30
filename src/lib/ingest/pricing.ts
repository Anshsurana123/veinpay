import type { SpotRates } from '@/lib/rates';
import type { NormalizedTransfer, TokenKind } from './types';

export const NATIVE_SYMBOL_BY_CHAIN: Record<number, string> = {
  1: 'ETH',
  42161: 'ETH',
  8453: 'ETH',
  10: 'ETH',
  59144: 'ETH',
  81457: 'ETH',
  252: 'ETH',
  167000: 'ETH',
  130: 'ETH',
  11155111: 'ETH',
  84532: 'ETH',
  421614: 'ETH',
  11155420: 'ETH',
  137: 'POL',
  80002: 'POL',
  56: 'BNB',
  5000: 'MNT',
  42220: 'CELO',
  146: 'S',
  80094: 'BERA',
  143: 'MON',
};

const STABLECOIN_SYMBOLS = new Set<string>([
  'USDC',
  'USDT',
  'DAI',
  'USDE',
  'FDUSD',
  'USDC.E',
  'FRAX',
  'LUSD',
  'PYUSD',
]);

export function getNativeSymbol(chainId: number): string {
  return NATIVE_SYMBOL_BY_CHAIN[chainId] || 'ETH';
}

export function isStablecoin(symbol: string): boolean {
  return STABLECOIN_SYMBOLS.has(symbol.trim().toUpperCase());
}

export interface PricingResult {
  symbol: string;
  decimals: number;
  amount: number;
  amountUsd: number | null;
  usdKnown: boolean;
  isSpam: boolean;
}

export function computeTransferPricing(params: {
  chainId: number;
  tokenKind: TokenKind;
  rawSymbol?: string | null;
  rawDecimals?: number | string | null;
  rawValueStr: string;
  spotRates?: Partial<SpotRates> | null;
  nativePriceUsd?: number;
}): PricingResult {
  const { chainId, tokenKind, rawSymbol, rawDecimals, rawValueStr, spotRates } = params;

  // 1. Parse raw BigInt value
  let rawValue = 0n;
  try {
    const cleanStr = rawValueStr.split('.')[0].trim();
    rawValue = BigInt(cleanStr);
  } catch {
    rawValue = 0n;
  }

  // 2. Resolve Symbol
  let symbol = (rawSymbol || '').trim().toUpperCase();
  if (!symbol) {
    symbol = tokenKind === 'native' || tokenKind === 'internal'
      ? getNativeSymbol(chainId)
      : 'UNKNOWN';
  }

  // 3. Resolve Decimals
  let decimals = 18;
  if (tokenKind === 'native' || tokenKind === 'internal') {
    decimals = 18;
  } else if (rawDecimals !== undefined && rawDecimals !== null && rawDecimals !== '') {
    const parsedDec = Number(rawDecimals);
    decimals = Number.isFinite(parsedDec) && parsedDec >= 0 ? parsedDec : 18;
  } else if (symbol === 'USDC' || symbol === 'USDT') {
    decimals = 6;
  } else {
    decimals = 18;
  }

  // 4. Compute human amount
  let amount = 0;
  if (decimals === 0) {
    amount = Number(rawValue);
  } else {
    const factor = 10n ** BigInt(decimals);
    const whole = rawValue / factor;
    const remainder = rawValue % factor;
    const wholeNum = Number(whole);
    const fractionNum = Number(remainder) / Number(factor);
    amount = wholeNum + fractionNum;
  }

  // 5. Detect Zero-value / Token Spam
  const isSpam = rawValue === 0n || (tokenKind === 'erc20' && amount === 0);

  // 6. Compute USD Pricing
  let amountUsd: number | null = null;
  let usdKnown = false;

  if (isStablecoin(symbol)) {
    // Stablecoin allowlist per chain = $1.00
    amountUsd = Number(amount.toFixed(2));
    usdKnown = true;
  } else if (symbol === 'ETH' || symbol === 'WETH') {
    const ethPrice = spotRates?.ETH ?? params.nativePriceUsd;
    if (ethPrice !== undefined && ethPrice > 0) {
      amountUsd = Number((amount * ethPrice).toFixed(2));
      usdKnown = true;
    }
  } else if (symbol === 'POL' || symbol === 'MATIC') {
    // POL native spot pricing (default ~0.40 if live oracle lacks POL)
    const polPrice = 0.40;
    amountUsd = Number((amount * polPrice).toFixed(2));
    usdKnown = true;
  } else if (symbol === 'BNB') {
    const bnbPrice = 600.0;
    amountUsd = Number((amount * bnbPrice).toFixed(2));
    usdKnown = true;
  } else if (tokenKind === 'native' || tokenKind === 'internal') {
    // Native on an ETH-compatible L2
    const nativePrice = params.nativePriceUsd ?? spotRates?.ETH;
    if (nativePrice !== undefined && nativePrice > 0) {
      amountUsd = Number((amount * nativePrice).toFixed(2));
      usdKnown = true;
    }
  }

  return {
    symbol,
    decimals,
    amount,
    amountUsd,
    usdKnown,
    isSpam,
  };
}
