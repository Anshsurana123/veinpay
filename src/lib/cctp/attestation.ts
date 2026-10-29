import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  http,
  type PublicClient,
} from 'viem';
import {
  CIRCLE_IRIS_SANDBOX_BASE_URL,
  getCctpChainConfig,
} from '@/lib/cctp/contracts';
import { MESSAGE_TRANSMITTER_V2_ABI } from '@/lib/cctp/encoding';

/**
 * Circle Iris V2 Attestation Message Schema
 * Endpoint: GET https://iris-api-sandbox.circle.com/v2/messages/{sourceDomain}?transactionHash={txHash}
 * Reference: https://developers.circle.com/cctp/v2/retrieve-attestation
 */
export interface CircleIrisV2MessageItem {
  sourceTxHash?: string;
  cctpVersion?: number;
  status?: 'complete' | 'pending_confirmations' | string;
  message?: `0x${string}`;
  attestation?: `0x${string}`;
  eventNonce?: string;
  decodedMessage?: {
    nonce?: string;
    sourceDomain?: string;
    destinationDomain?: string;
    decodedMessageBody?: {
      burnToken?: string;
      mintRecipient?: string;
      amount?: string;
      messageSender?: string;
      maxFee?: string;
      feeExecuted?: string;
    };
  };
  decodedMessageBody?: {
    burnToken?: string;
    mintRecipient?: string;
    amount?: string;
    messageSender?: string;
  };
}

export interface CircleIrisAttestationCheckResult {
  state: 'ATTESTED' | 'PENDING' | 'ERROR';
  sourceDomain: number;
  transactionHash: `0x${string}`;
  message?: `0x${string}`;
  attestation?: `0x${string}`;
  cctpVersion?: number;
  nonce?: string;
  irisStatus?: string;
  errorMessage?: string;
}

export async function fetchCctpAttestationOnce(params: {
  sourceDomain: number;
  transactionHash: string;
  irisBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CircleIrisAttestationCheckResult> {
  const txHash = params.transactionHash.trim() as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return {
      state: 'ERROR',
      sourceDomain: params.sourceDomain,
      transactionHash: txHash,
      errorMessage: `Invalid 32-byte burn transactionHash: "${params.transactionHash}"`,
    };
  }

  const baseUrl = (params.irisBaseUrl || CIRCLE_IRIS_SANDBOX_BASE_URL).replace(
    /\/+$/,
    ''
  );
  const url = `${baseUrl}/v2/messages/${params.sourceDomain}?transactionHash=${encodeURIComponent(txHash)}`;
  const fetcher = params.fetchImpl ?? fetch;

  try {
    const res = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(params.timeoutMs ?? 4000),
    });

    if (res.status === 404) {
      return {
        state: 'PENDING',
        sourceDomain: params.sourceDomain,
        transactionHash: txHash,
        irisStatus: 'not_indexed_yet',
      };
    }

    if (!res.ok) {
      return {
        state: 'ERROR',
        sourceDomain: params.sourceDomain,
        transactionHash: txHash,
        errorMessage: `Circle Iris API returned HTTP ${res.status}`,
      };
    }

    const payload = (await res.json()) as {
      messages?: CircleIrisV2MessageItem[];
    };

    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        state: 'PENDING',
        sourceDomain: params.sourceDomain,
        transactionHash: txHash,
        irisStatus: 'empty_messages',
      };
    }

    const msg = messages[0];
    if (
      msg.status === 'complete' &&
      msg.message &&
      msg.message.startsWith('0x') &&
      msg.attestation &&
      msg.attestation.startsWith('0x') &&
      msg.attestation !== '0x' &&
      !msg.attestation.toLowerCase().includes('pending')
    ) {
      return {
        state: 'ATTESTED',
        sourceDomain: params.sourceDomain,
        transactionHash: txHash,
        message: msg.message,
        attestation: msg.attestation,
        cctpVersion: msg.cctpVersion ?? 2,
        nonce: msg.eventNonce ?? msg.decodedMessage?.nonce,
        irisStatus: msg.status,
      };
    }

    return {
      state: 'PENDING',
      sourceDomain: params.sourceDomain,
      transactionHash: txHash,
      irisStatus: msg.status ?? 'pending_confirmations',
    };
  } catch (err) {
    return {
      state: 'ERROR',
      sourceDomain: params.sourceDomain,
      transactionHash: txHash,
      errorMessage:
        err instanceof Error
          ? err.message
          : 'Circle Iris attestation fetch failed',
    };
  }
}

export interface PollCctpAttestationOptions {
  sourceDomain: number;
  transactionHash: string;
  irisBaseUrl?: string;
  fetchImpl?: typeof fetch;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface PollCctpAttestationResult
  extends Omit<CircleIrisAttestationCheckResult, 'state'> {
  state: 'ATTESTED' | 'TIMEOUT' | 'ERROR';
  attempts: number;
  elapsedMs: number;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls Circle's Iris V2 attestation API with exponential backoff and a timeout budget.
 */
export async function pollCctpAttestationWithBackoff(
  options: PollCctpAttestationOptions
): Promise<PollCctpAttestationResult> {
  const start = performance.now();
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const backoffMultiplier = options.backoffMultiplier ?? 1.6;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxAttempts = options.maxAttempts ?? 25;

  let currentDelay = initialDelayMs;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;
    const check = await fetchCctpAttestationOnce({
      sourceDomain: options.sourceDomain,
      transactionHash: options.transactionHash,
      irisBaseUrl: options.irisBaseUrl,
      fetchImpl: options.fetchImpl,
      timeoutMs: Math.min(4000, Math.max(500, timeoutMs)),
    });

    if (check.state === 'ATTESTED') {
      return {
        ...check,
        state: 'ATTESTED',
        attempts,
        elapsedMs: Number((performance.now() - start).toFixed(2)),
      };
    }

    if (check.state === 'ERROR') {
      return {
        ...check,
        state: 'ERROR',
        attempts,
        elapsedMs: Number((performance.now() - start).toFixed(2)),
      };
    }

    const elapsedSoFar = performance.now() - start;
    if (elapsedSoFar + currentDelay >= timeoutMs || attempts >= maxAttempts) {
      return {
        state: 'TIMEOUT',
        sourceDomain: options.sourceDomain,
        transactionHash: options.transactionHash.trim() as `0x${string}`,
        irisStatus: check.irisStatus ?? 'pending_confirmations',
        errorMessage: `Timed out waiting for Circle Iris attestation after ${attempts} attempts (${Math.round(elapsedSoFar)}ms)`,
        attempts,
        elapsedMs: Number(elapsedSoFar.toFixed(2)),
      };
    }

    await waitMs(currentDelay);
    currentDelay = Math.min(
      maxDelayMs,
      Math.ceil(currentDelay * backoffMultiplier)
    );
  }

  return {
    state: 'TIMEOUT',
    sourceDomain: options.sourceDomain,
    transactionHash: options.transactionHash.trim() as `0x${string}`,
    errorMessage: `Exceeded maxAttempts (${maxAttempts}) waiting for Circle Iris attestation`,
    attempts,
    elapsedMs: Number((performance.now() - start).toFixed(2)),
  };
}

export interface VerifyCctpMintParams {
  destinationChainId: number;
  mintTxHash: `0x${string}`;
  expectedReceiverAddress: `0x${string}`;
  expectedMinNetAmountAtomic?: bigint;
  publicClient?: Pick<PublicClient, 'getTransactionReceipt'>;
}

export interface VerifyCctpMintResult {
  verified: boolean;
  status: 'CONFIRMED' | 'FAILED';
  mintTxHash: `0x${string}`;
  destinationChainId: number;
  messageReceivedEventFound: boolean;
  usdcTransferAmountAtomic: string;
  reason?: string;
}

/**
 * Verifies on the destination testnet chain that `MessageTransmitterV2.receiveMessage` succeeded,
 * emitted `MessageReceived`, and minted USDC to the verified receiver vault address.
 */
export async function verifyCctpMintOnDestination(
  params: VerifyCctpMintParams
): Promise<VerifyCctpMintResult> {
  const destCfg = getCctpChainConfig(params.destinationChainId);
  if (!destCfg) {
    return {
      verified: false,
      status: 'FAILED',
      mintTxHash: params.mintTxHash,
      destinationChainId: params.destinationChainId,
      messageReceivedEventFound: false,
      usdcTransferAmountAtomic: '0',
      reason: `Unsupported CCTP destination chainId: ${params.destinationChainId}`,
    };
  }

  const client =
    params.publicClient ??
    createPublicClient({
      transport: http(destCfg.rpcUrls[0], { timeout: 6000 }),
    });

  try {
    const receipt = await client.getTransactionReceipt({
      hash: params.mintTxHash,
    });

    if (receipt.status !== 'success') {
      return {
        verified: false,
        status: 'FAILED',
        mintTxHash: params.mintTxHash,
        destinationChainId: params.destinationChainId,
        messageReceivedEventFound: false,
        usdcTransferAmountAtomic: '0',
        reason: 'Destination mint transaction reverted on-chain',
      };
    }

    let messageReceivedEventFound = false;
    let usdcTransferAmount = 0n;
    const expectedReceiverLower = params.expectedReceiverAddress.toLowerCase();
    const messageTransmitterLower = destCfg.messageTransmitterV2.toLowerCase();
    const usdcDestLower = destCfg.usdcAddress.toLowerCase();

    for (const log of receipt.logs) {
      const logAddr = log.address.toLowerCase();

      if (logAddr === messageTransmitterLower) {
        try {
          const decoded = decodeEventLog({
            abi: MESSAGE_TRANSMITTER_V2_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'MessageReceived') {
            messageReceivedEventFound = true;
          }
        } catch {
          // Ignore non-matching log
        }
      }

      if (logAddr === usdcDestLower) {
        try {
          const decoded = decodeEventLog({
            abi: erc20Abi,
            data: log.data,
            topics: log.topics,
          });
          if (
            decoded.eventName === 'Transfer' &&
            decoded.args.to.toLowerCase() === expectedReceiverLower
          ) {
            usdcTransferAmount += decoded.args.value;
          }
        } catch {
          // Ignore non-Transfer log
        }
      }
    }

    if (!messageReceivedEventFound) {
      return {
        verified: false,
        status: 'FAILED',
        mintTxHash: params.mintTxHash,
        destinationChainId: params.destinationChainId,
        messageReceivedEventFound: false,
        usdcTransferAmountAtomic: usdcTransferAmount.toString(),
        reason:
          'Transaction receipt did not emit MessageTransmitterV2.MessageReceived event',
      };
    }

    if (usdcTransferAmount <= 0n) {
      return {
        verified: false,
        status: 'FAILED',
        mintTxHash: params.mintTxHash,
        destinationChainId: params.destinationChainId,
        messageReceivedEventFound: true,
        usdcTransferAmountAtomic: '0',
        reason: `No USDC Transfer event found to verified receiver ${params.expectedReceiverAddress}`,
      };
    }

    if (
      params.expectedMinNetAmountAtomic &&
      usdcTransferAmount < params.expectedMinNetAmountAtomic
    ) {
      return {
        verified: false,
        status: 'FAILED',
        mintTxHash: params.mintTxHash,
        destinationChainId: params.destinationChainId,
        messageReceivedEventFound: true,
        usdcTransferAmountAtomic: usdcTransferAmount.toString(),
        reason: `Minted USDC (${usdcTransferAmount.toString()}) is less than expected net amount (${params.expectedMinNetAmountAtomic.toString()})`,
      };
    }

    return {
      verified: true,
      status: 'CONFIRMED',
      mintTxHash: params.mintTxHash,
      destinationChainId: params.destinationChainId,
      messageReceivedEventFound: true,
      usdcTransferAmountAtomic: usdcTransferAmount.toString(),
    };
  } catch (err) {
    return {
      verified: false,
      status: 'FAILED',
      mintTxHash: params.mintTxHash,
      destinationChainId: params.destinationChainId,
      messageReceivedEventFound: false,
      usdcTransferAmountAtomic: '0',
      reason:
        err instanceof Error
          ? err.message
          : 'Failed to fetch destination mint receipt',
    };
  }
}
