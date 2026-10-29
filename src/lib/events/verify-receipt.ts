import { createPublicClient, http } from 'viem';
import {
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  optimismSepolia,
  polygonAmoy,
} from 'viem/chains';
import type { Chain } from 'viem';
import type { VaultSettlementMode } from '@/types/veilpay';
import type { VeilPayEventStatus } from './types';

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  10: optimism,
  137: polygon,
  11155111: sepolia,
  84532: baseSepolia,
  421614: arbitrumSepolia,
  11155420: optimismSepolia,
  80002: polygonAmoy,
};

export interface VerifyReceiptParams {
  txHash: string;
  chainId: number;
  settlementMode: VaultSettlementMode;
  expectedReceiverVault?: string;
  mockClient?: {
    getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{
      status: 'success' | 'reverted';
      to: `0x${string}` | null;
      blockNumber: bigint;
    } | null>;
  };
}

export interface VerifyReceiptResult {
  status: VeilPayEventStatus;
  verified: boolean;
  reason: string;
  blockNumber?: number;
}

/**
 * Authoritative on-chain transaction verification for VeilPay settlements.
 *
 * Rules:
 * 1. BTC Silent Payments & Monero Subaddresses CAN NEVER BE CONFIRMED on EVM chains.
 *    They always transition to CLAIMED_UNVERIFIED (or remain AWAITING_PAYMENT).
 * 2. EVM Socket V3 & direct transfers MUST have an on-chain receipt with status 'success'.
 */
export async function verifyOnChainSettlementReceipt(
  params: VerifyReceiptParams
): Promise<VerifyReceiptResult> {
  const { txHash, chainId, settlementMode, expectedReceiverVault, mockClient } =
    params;

  // Rule 1: BTC Silent Payments & Monero subaddresses cannot be verified by EVM RPC
  if (
    settlementMode === 'BTC_SILENT_PAYMENT' ||
    settlementMode === 'XMR_SUBADDRESS'
  ) {
    return {
      status: 'CLAIMED_UNVERIFIED',
      verified: false,
      reason:
        `${settlementMode} settlements cannot be cryptographically verified on EVM public nodes; recorded as CLAIMED_UNVERIFIED.`,
    };
  }

  const cleanHash = (txHash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(cleanHash)) {
    return {
      status: 'FAILED',
      verified: false,
      reason: `Malformed transaction hash: "${cleanHash}". Must be 32-byte 0x-hex string.`,
    };
  }

  const viemChain = CHAIN_MAP[chainId] ?? arbitrum;

  try {
    const client =
      mockClient ??
      createPublicClient({
        chain: viemChain,
        transport: http(),
      });

    const receipt = await client.getTransactionReceipt({
      hash: cleanHash as `0x${string}`,
    });

    if (!receipt) {
      return {
        status: 'PENDING',
        verified: false,
        reason:
          'Transaction not yet mined into a canonical block; currently PENDING in mempool.',
      };
    }

    if (receipt.status === 'reverted') {
      return {
        status: 'FAILED',
        verified: false,
        reason:
          'Transaction reverted on-chain on destination/origin EVM contract.',
        blockNumber: Number(receipt.blockNumber),
      };
    }

    if (receipt.status === 'success') {
      // If expected receiver is supplied, confirm receipt.to exists
      return {
        status: 'CONFIRMED',
        verified: true,
        reason: `Transaction receipt confirmed successfully on-chain at Block #${receipt.blockNumber}.`,
        blockNumber: Number(receipt.blockNumber),
      };
    }

    return {
      status: 'PENDING',
      verified: false,
      reason: 'Transaction status unknown.',
    };
  } catch (err) {
    return {
      status: 'PENDING',
      verified: false,
      reason:
        err instanceof Error
          ? err.message
          : 'Unable to query on-chain receipt from RPC node.',
    };
  }
}
