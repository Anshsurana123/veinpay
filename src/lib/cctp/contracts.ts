import { isAddress } from 'viem';
import type { SupportedEvmChainId } from '@/types/veinpay';

/**
 * Official Circle CCTP V2 EVM Testnet Contract Addresses & Domain Registry
 *
 * Authoritative References (Verified against official Circle docs):
 * - Contract Addresses: https://developers.circle.com/cctp/evm/contract-addresses
 * - Supported Domains & Fast Transfer Support: https://developers.circle.com/cctp/v2/supported-domains
 * - USDC Testnet Contract Addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses
 *
 * Note on Polygon PoS Amoy (Domain 7):
 * Per Circle's Supported Domains table, Polygon PoS / Amoy is NOT supported as a source chain
 * for Fast Transfer (marked "N/A" because Polygon native finality is already fast).
 * Therefore, transfers originating from Polygon Amoy use Standard Finality (minFinalityThreshold = 2000).
 */

export const CIRCLE_IRIS_SANDBOX_BASE_URL =
  process.env.CIRCLE_IRIS_SANDBOX_URL?.trim() ||
  'https://iris-api-sandbox.circle.com';

export const CCTP_V2_TESTNET_SHARED_CONTRACTS = {
  // Official Circle CCTP V2 Testnet TokenMessengerV2 (Ethereum Sepolia, OP Sepolia, Arbitrum Sepolia, Base Sepolia, Polygon Amoy)
  // Source: https://developers.circle.com/cctp/evm/contract-addresses#tokenmessengerv2-testnet
  tokenMessengerV2:
    '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as `0x${string}`,

  // Official Circle CCTP V2 Testnet MessageTransmitterV2
  // Source: https://developers.circle.com/cctp/evm/contract-addresses#messagetransmitterv2-testnet
  messageTransmitterV2:
    '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as `0x${string}`,

  // Official Circle CCTP V2 Testnet TokenMinterV2
  // Source: https://developers.circle.com/cctp/evm/contract-addresses#tokenminterv2-testnet
  tokenMinterV2:
    '0xb43db544E2c27092c107639Ad201b3dEfAbcF192' as `0x${string}`,
} as const;

export type CctpTestnetChainId =
  | 11155111
  | 11155420
  | 421614
  | 84532
  | 80002;

export interface CctpTestnetChainConfig {
  chainId: CctpTestnetChainId;
  name: string;
  shortName: string;
  domain: 0 | 2 | 3 | 6 | 7;
  usdcAddress: `0x${string}`;
  tokenMessengerV2: `0x${string}`;
  messageTransmitterV2: `0x${string}`;
  tokenMinterV2: `0x${string}`;
  fastTransferSupportedAsSource: boolean;
  fastExpectedSeconds: number | null;
  fastExpectedDisplay: string | null;
  standardExpectedSeconds: number;
  standardExpectedDisplay: string;
  forwardingSupported: boolean;
  rpcUrls: string[];
  explorerUrl: string;
}

export const CCTP_TESTNET_CHAINS: Record<
  CctpTestnetChainId,
  CctpTestnetChainConfig
> = {
  // Domain 0: Ethereum Sepolia
  11155111: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    shortName: 'Eth Sepolia',
    domain: 0,
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenMessengerV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMessengerV2,
    messageTransmitterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.messageTransmitterV2,
    tokenMinterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMinterV2,
    fastTransferSupportedAsSource: true,
    fastExpectedSeconds: 20,
    fastExpectedDisplay: '~15–20 sec (Fast Transfer Soft-Finality)',
    standardExpectedSeconds: 900,
    standardExpectedDisplay: '~13–19 min (Ethereum L1 Hard Finality)',
    forwardingSupported: true,
    rpcUrls: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://rpc.sepolia.org',
    ],
    explorerUrl: 'https://sepolia.etherscan.io',
  },

  // Domain 2: OP Sepolia
  11155420: {
    chainId: 11155420,
    name: 'OP Sepolia',
    shortName: 'OP Sepolia',
    domain: 2,
    usdcAddress: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    tokenMessengerV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMessengerV2,
    messageTransmitterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.messageTransmitterV2,
    tokenMinterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMinterV2,
    fastTransferSupportedAsSource: true,
    fastExpectedSeconds: 15,
    fastExpectedDisplay: '~10–20 sec (Fast Transfer Soft-Finality)',
    standardExpectedSeconds: 900,
    standardExpectedDisplay: '~13–19 min (L1 Batch Hard Finality)',
    forwardingSupported: true,
    rpcUrls: ['https://sepolia.optimism.io'],
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
  },

  // Domain 3: Arbitrum Sepolia
  421614: {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    shortName: 'Arb Sepolia',
    domain: 3,
    usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    tokenMessengerV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMessengerV2,
    messageTransmitterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.messageTransmitterV2,
    tokenMinterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMinterV2,
    fastTransferSupportedAsSource: true,
    fastExpectedSeconds: 15,
    fastExpectedDisplay: '~8–20 sec (Fast Transfer Soft-Finality)',
    standardExpectedSeconds: 900,
    standardExpectedDisplay: '~13–19 min (L1 Batch Hard Finality)',
    forwardingSupported: true,
    rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
    explorerUrl: 'https://sepolia.arbiscan.io',
  },

  // Domain 6: Base Sepolia
  84532: {
    chainId: 84532,
    name: 'Base Sepolia',
    shortName: 'Base Sepolia',
    domain: 6,
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokenMessengerV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMessengerV2,
    messageTransmitterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.messageTransmitterV2,
    tokenMinterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMinterV2,
    fastTransferSupportedAsSource: true,
    fastExpectedSeconds: 15,
    fastExpectedDisplay: '~10–20 sec (Fast Transfer Soft-Finality)',
    standardExpectedSeconds: 900,
    standardExpectedDisplay: '~13–19 min (L1 Batch Hard Finality)',
    forwardingSupported: true,
    rpcUrls: ['https://sepolia.base.org'],
    explorerUrl: 'https://sepolia.basescan.org',
  },

  // Domain 7: Polygon PoS Amoy (Fast Transfer as source = N/A per Circle docs)
  80002: {
    chainId: 80002,
    name: 'Polygon Amoy',
    shortName: 'Polygon Amoy',
    domain: 7,
    usdcAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    tokenMessengerV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMessengerV2,
    messageTransmitterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.messageTransmitterV2,
    tokenMinterV2: CCTP_V2_TESTNET_SHARED_CONTRACTS.tokenMinterV2,
    fastTransferSupportedAsSource: false,
    fastExpectedSeconds: null,
    fastExpectedDisplay: null,
    standardExpectedSeconds: 15,
    standardExpectedDisplay: '~8–20 sec (Polygon Standard Finality)',
    forwardingSupported: true,
    rpcUrls: ['https://rpc-amoy.polygon.technology'],
    explorerUrl: 'https://amoy.polygonscan.com',
  },
};

const REQUIRED_TESTNET_CHAIN_IDS: CctpTestnetChainId[] = [
  11155111,
  11155420,
  421614,
  84532,
  80002,
];

/**
 * Validates every CCTP V2 contract address in the registry using strict EIP-55 checksum rules.
 * Throws an error immediately if any address is missing or malformed so builds/tests fail closed.
 */
export function assertCctpTestnetContractsValid(
  registry: Record<number, Partial<CctpTestnetChainConfig>> = CCTP_TESTNET_CHAINS
): void {
  for (const chainId of REQUIRED_TESTNET_CHAIN_IDS) {
    const cfg = registry[chainId];
    if (!cfg) {
      throw new Error(
        `Missing CCTP V2 testnet configuration for chainId ${chainId}`
      );
    }
    const fields: Array<keyof Pick<
      CctpTestnetChainConfig,
      'usdcAddress' | 'tokenMessengerV2' | 'messageTransmitterV2' | 'tokenMinterV2'
    >> = [
      'usdcAddress',
      'tokenMessengerV2',
      'messageTransmitterV2',
      'tokenMinterV2',
    ];

    for (const field of fields) {
      const value = cfg[field];
      if (!value || typeof value !== 'string' || !isAddress(value, { strict: true })) {
        throw new Error(
          `Invalid or missing CCTP V2 ${field} on chain ${chainId}: "${String(value)}"`
        );
      }
    }
  }
}

// Run validation at module load so any broken address fails build/test immediately
assertCctpTestnetContractsValid();

export function isCctpTestnetChain(
  chainId: number
): chainId is CctpTestnetChainId {
  return Object.prototype.hasOwnProperty.call(CCTP_TESTNET_CHAINS, chainId);
}

export const isSupportedCctpTestnetChain = isCctpTestnetChain;

export function getCctpDomainForChain(chainId: number): number | null {
  const cfg = getCctpChainConfig(chainId);
  return cfg ? cfg.domain : null;
}

export function getCctpChainConfig(
  chainId: number
): CctpTestnetChainConfig | null {
  if (!isCctpTestnetChain(chainId)) return null;
  return CCTP_TESTNET_CHAINS[chainId];
}

export function getCctpChainByDomain(
  domain: number
): CctpTestnetChainConfig | null {
  return (
    Object.values(CCTP_TESTNET_CHAINS).find((c) => c.domain === domain) ?? null
  );
}

export function isTestnetUsdcToken(
  chainId: SupportedEvmChainId | number,
  tokenAddressOrSymbol: string
): boolean {
  const cfg = getCctpChainConfig(chainId);
  if (!cfg) return false;
  const trimmed = tokenAddressOrSymbol.trim();
  if (trimmed.toUpperCase() === 'USDC') return true;
  return trimmed.toLowerCase() === cfg.usdcAddress.toLowerCase();
}
