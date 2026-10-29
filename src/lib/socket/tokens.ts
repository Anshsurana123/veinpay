import type { PaymentAssetSymbol, SupportedEvmChainId } from '@/types/veilpay';

export interface EvmChainMetadata {
  chainId: SupportedEvmChainId;
  name: string;
  shortName: string;
  nativeSymbol: string;
  explorerUrl: string;
  etherscanFreeTier: boolean;
  isTestnet: boolean;
  faucetUrl?: string;
}

export const SUPPORTED_EVM_CHAINS: EvmChainMetadata[] = [
  // Mainnets
  {
    chainId: 8453,
    name: 'Base Mainnet',
    shortName: 'Base',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://basescan.org',
    etherscanFreeTier: false,
    isTestnet: false,
  },
  {
    chainId: 42161,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://arbiscan.io',
    etherscanFreeTier: true,
    isTestnet: false,
  },
  {
    chainId: 1,
    name: 'Ethereum Mainnet',
    shortName: 'Ethereum',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://etherscan.io',
    etherscanFreeTier: true,
    isTestnet: false,
  },
  {
    chainId: 10,
    name: 'OP Mainnet',
    shortName: 'Optimism',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://optimistic.etherscan.io',
    etherscanFreeTier: false,
    isTestnet: false,
  },
  {
    chainId: 137,
    name: 'Polygon PoS',
    shortName: 'Polygon',
    nativeSymbol: 'POL',
    explorerUrl: 'https://polygonscan.com',
    etherscanFreeTier: true,
    isTestnet: false,
  },
  // Testnets
  {
    chainId: 84532,
    name: 'Base Sepolia (Testnet)',
    shortName: 'Base Sepolia',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.basescan.org',
    etherscanFreeTier: true,
    isTestnet: true,
    faucetUrl: 'https://faucet.circle.com/',
  },
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia (Testnet)',
    shortName: 'Arb Sepolia',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.arbiscan.io',
    etherscanFreeTier: true,
    isTestnet: true,
    faucetUrl: 'https://faucet.circle.com/',
  },
  {
    chainId: 11155111,
    name: 'Ethereum Sepolia (Testnet)',
    shortName: 'Eth Sepolia',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io',
    etherscanFreeTier: true,
    isTestnet: true,
    faucetUrl: 'https://faucet.circle.com/',
  },
  {
    chainId: 11155420,
    name: 'OP Sepolia (Testnet)',
    shortName: 'OP Sepolia',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
    etherscanFreeTier: true,
    isTestnet: true,
    faucetUrl: 'https://faucet.circle.com/',
  },
  {
    chainId: 80002,
    name: 'Polygon Amoy (Testnet)',
    shortName: 'Polygon Amoy',
    nativeSymbol: 'POL',
    explorerUrl: 'https://amoy.polygonscan.com',
    etherscanFreeTier: true,
    isTestnet: true,
    faucetUrl: 'https://faucet.polygon.technology/',
  },
];

export function isTestnetChain(chainId: number): boolean {
  return Boolean(
    SUPPORTED_EVM_CHAINS.find((c) => c.chainId === chainId)?.isTestnet
  );
}

export function getChainExplorerUrl(chainId: number): string {
  return (
    SUPPORTED_EVM_CHAINS.find((c) => c.chainId === chainId)?.explorerUrl ??
    'https://etherscan.io'
  );
}

export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export interface TokenConfig {
  symbol: 'USDC' | 'ETH' | 'USDT';
  name: string;
  decimals: number;
  approxUsdPrice?: number;
  addressesByChain: Record<SupportedEvmChainId, string>;
}

export const EVM_TOKEN_REGISTRY: Record<'USDC' | 'ETH' | 'USDT', TokenConfig> = {
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    approxUsdPrice: 1.0,
    addressesByChain: {
      // Mainnets
      1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      // Official Circle Testnet USDC Contracts
      11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      421614: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      11155420: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
      80002: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    },
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    approxUsdPrice: 1.0,
    addressesByChain: {
      // Mainnets
      1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      8453: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      10: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      // Testnet USDT Equivalents
      11155111: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
      84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      421614: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      11155420: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
      80002: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    },
  },
  ETH: {
    symbol: 'ETH',
    name: 'Native Ether',
    decimals: 18,
    addressesByChain: {
      1: NATIVE_TOKEN_ADDRESS,
      42161: NATIVE_TOKEN_ADDRESS,
      8453: NATIVE_TOKEN_ADDRESS,
      10: NATIVE_TOKEN_ADDRESS,
      137: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      11155111: NATIVE_TOKEN_ADDRESS,
      84532: NATIVE_TOKEN_ADDRESS,
      421614: NATIVE_TOKEN_ADDRESS,
      11155420: NATIVE_TOKEN_ADDRESS,
      80002: NATIVE_TOKEN_ADDRESS,
    },
  },
};

export function resolveTokenByAddressOrSymbol(
  chainId: number,
  tokenInput: string
): {
  address: string;
  symbol: 'USDC' | 'ETH' | 'USDT';
  decimals: number;
  approxUsdPrice?: number;
} {
  const cId = (SUPPORTED_EVM_CHAINS.some((c) => c.chainId === chainId)
    ? chainId
    : 8453) as SupportedEvmChainId;

  const upper = tokenInput.trim().toUpperCase();
  if (upper === 'USDC' || upper === 'USDT' || upper === 'ETH') {
    const cfg = EVM_TOKEN_REGISTRY[upper];
    return {
      address: cfg.addressesByChain[cId],
      symbol: cfg.symbol,
      decimals: cfg.decimals,
      approxUsdPrice: cfg.approxUsdPrice,
    };
  }

  const lowerAddr = tokenInput.trim().toLowerCase();
  for (const cfg of Object.values(EVM_TOKEN_REGISTRY)) {
    for (const addr of Object.values(cfg.addressesByChain)) {
      if (addr.toLowerCase() === lowerAddr) {
        return {
          address: addr,
          symbol: cfg.symbol,
          decimals: cfg.decimals,
          approxUsdPrice: cfg.approxUsdPrice,
        };
      }
    }
  }

  return {
    address: EVM_TOKEN_REGISTRY.USDC.addressesByChain[cId],
    symbol: 'USDC',
    decimals: 6,
    approxUsdPrice: 1.0,
  };
}

export function toAtomicUnits(humanAmount: string | number, decimals: number): string {
  const num = Number(humanAmount);
  if (Number.isNaN(num) || num <= 0) {
    return (10 ** decimals).toString();
  }
  const [intPart, fracPart = ''] = num.toFixed(Math.min(decimals, 8)).split('.');
  const paddedFrac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const combined = BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(paddedFrac || '0');
  return combined.toString();
}

export function fromAtomicUnits(atomicStr: string, decimals: number): string {
  try {
    const val = BigInt(atomicStr);
    const divisor = 10n ** BigInt(decimals);
    const whole = val / divisor;
    const rem = val % divisor;
    if (rem === 0n) return whole.toString();
    const fracStr = rem
      .toString()
      .padStart(decimals, '0')
      .slice(0, 6)
      .replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return atomicStr;
  }
}

export function getChainDisplayName(chainId: number): string {
  return (
    SUPPORTED_EVM_CHAINS.find((c) => c.chainId === chainId)?.shortName ??
    `Chain ${chainId}`
  );
}
