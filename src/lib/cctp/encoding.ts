import {
  encodeFunctionData,
  getAddress,
  isAddress,
  pad,
  type Address,
} from 'viem';

/**
 * Official Circle CCTP V2 EVM Smart Contract Interfaces & Calldata Encoding
 * Reference: https://developers.circle.com/cctp/v2/evm-smart-contracts
 * Forwarding Service Hook Reference: https://developers.circle.com/cctp/v2/forwarding-service
 */

export const ZERO_BYTES32: `0x${string}` =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Circle CCTP V2 Forwarding Service static 32-byte hookData header:
 * - Bytes 0..23: ASCII "cctp-forward" right-padded with zeros to 24 bytes (0x636374702d666f7277617264...)
 * - Bytes 24..27: uint32 version = 0
 * - Bytes 28..31: uint32 additional payload length = 0
 */
export const CCTP_FORWARDING_HOOK_DATA: `0x${string}` =
  '0x636374702d666f72776172640000000000000000000000000000000000000000';

export const TOKEN_MESSENGER_V2_ABI = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [{ name: 'nonce', type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'depositForBurnWithHook',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ name: 'nonce', type: 'uint64' }],
  },
  {
    type: 'event',
    name: 'DepositForBurn',
    inputs: [
      { name: 'burnToken', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'mintRecipient', type: 'bytes32', indexed: false },
      { name: 'destinationDomain', type: 'uint32', indexed: false },
      { name: 'destinationTokenMessenger', type: 'bytes32', indexed: false },
      { name: 'destinationCaller', type: 'bytes32', indexed: false },
      { name: 'maxFee', type: 'uint256', indexed: false },
      { name: 'minFinalityThreshold', type: 'uint32', indexed: true },
      { name: 'hookData', type: 'bytes', indexed: false },
    ],
  },
] as const;

export const MESSAGE_TRANSMITTER_V2_ABI = [
  {
    type: 'function',
    name: 'receiveMessage',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'MessageReceived',
    inputs: [
      { name: 'caller', type: 'address', indexed: true },
      { name: 'sourceDomain', type: 'uint32', indexed: false },
      { name: 'nonce', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'bytes32', indexed: false },
      { name: 'finalityThresholdExecuted', type: 'uint32', indexed: true },
      { name: 'messageBody', type: 'bytes', indexed: false },
    ],
  },
] as const;

/**
 * Left-pads a 20-byte EVM address into a 32-byte hex word (`bytes32`) as required by
 * Circle's `MessageV2.addressToBytes32`.
 */
export function addressToBytes32(evmAddress: string): `0x${string}` {
  const trimmed = evmAddress.trim();
  if (!isAddress(trimmed, { strict: false })) {
    throw new Error(`Invalid EVM address for bytes32 padding: "${evmAddress}"`);
  }
  const checksummed = getAddress(trimmed);
  const padded = pad(checksummed, { size: 32 }).toLowerCase();
  return padded as `0x${string}`;
}

/**
 * Extracts a checksummed 20-byte EVM address from a left-padded 32-byte hex word (`bytes32`).
 */
export function bytes32ToAddress(bytes32Hex: string): Address {
  const cleaned = bytes32Hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error(`Invalid bytes32 hex string: "${bytes32Hex}"`);
  }
  if (!/^0{24}/.test(cleaned)) {
    throw new Error(
      `bytes32 value does not have 12 leading zero bytes for an EVM address: "${bytes32Hex}"`
    );
  }
  const rawAddr = `0x${cleaned.slice(24)}`;
  return getAddress(rawAddr);
}

export interface EncodeDepositForBurnParams {
  amountAtomic: bigint | string;
  destinationDomain: number;
  mintRecipientAddress: string;
  burnTokenAddress: string;
  destinationCallerAddress?: string | null;
  maxFeeAtomic: bigint | string;
  minFinalityThreshold: 1000 | 2000;
  useForwardingService?: boolean;
}

export function encodeDepositForBurnCalldata(
  params: EncodeDepositForBurnParams
): `0x${string}` {
  const amount = BigInt(params.amountAtomic);
  if (amount <= 0n) {
    throw new Error('CCTP depositForBurn amount must be greater than 0');
  }
  const maxFee = BigInt(params.maxFeeAtomic);
  if (maxFee < 0n || maxFee >= amount) {
    throw new Error(
      `CCTP maxFee (${maxFee.toString()}) must be non-negative and strictly less than burn amount (${amount.toString()})`
    );
  }

  const mintRecipient = addressToBytes32(params.mintRecipientAddress);
  const burnToken = getAddress(params.burnTokenAddress.trim());
  const destinationCaller = params.destinationCallerAddress
    ? addressToBytes32(params.destinationCallerAddress)
    : ZERO_BYTES32;

  if (params.useForwardingService) {
    return encodeFunctionData({
      abi: TOKEN_MESSENGER_V2_ABI,
      functionName: 'depositForBurnWithHook',
      args: [
        amount,
        params.destinationDomain,
        mintRecipient,
        burnToken,
        destinationCaller,
        maxFee,
        params.minFinalityThreshold,
        CCTP_FORWARDING_HOOK_DATA,
      ],
    });
  }

  return encodeFunctionData({
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: 'depositForBurn',
    args: [
      amount,
      params.destinationDomain,
      mintRecipient,
      burnToken,
      destinationCaller,
      maxFee,
      params.minFinalityThreshold,
    ],
  });
}

export function encodeReceiveMessageCalldata(params: {
  message: `0x${string}`;
  attestation: `0x${string}`;
}): `0x${string}` {
  if (
    !params.message.startsWith('0x') ||
    params.message.length < 10 ||
    !params.attestation.startsWith('0x') ||
    params.attestation.length < 10
  ) {
    throw new Error(
      'Invalid CCTP message or attestation hex payload for receiveMessage'
    );
  }
  return encodeFunctionData({
    abi: MESSAGE_TRANSMITTER_V2_ABI,
    functionName: 'receiveMessage',
    args: [params.message, params.attestation],
  });
}
