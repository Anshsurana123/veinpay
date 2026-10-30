import { getAddress, isAddress } from 'viem';
import type {
  CctpFinalityMode,
  CctpRoute,
  NormalizedSocketRoute,
  VeinPayQuoteResponse,
} from '@/types/veinpay';
import {
  CIRCLE_IRIS_SANDBOX_BASE_URL,
  getCctpChainConfig,
  isTestnetUsdcToken,
} from '@/lib/cctp/contracts';
import {
  addressToBytes32,
  encodeDepositForBurnCalldata,
  ZERO_BYTES32,
} from '@/lib/cctp/encoding';
import { fromAtomicUnits } from '@/lib/socket/tokens';

/**
 * Circle Iris V2 Fee API Response Item
 * Endpoint: GET https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/{sourceDomainId}/{destDomainId}
 * Reference: https://developers.circle.com/cctp/v2/fees
 */
export interface CircleIrisFeeTier {
  finalityThreshold: number;
  minimumFee: number; // in basis points (1 = 0.01% = 0.0001)
  forwardFee?: {
    low?: number;
    medium?: number;
    high?: number;
  };
}

export interface ComputeCctpQuoteParams {
  sourceChainId: number;
  destinationChainId: number;
  inputToken: string;
  outputToken?: string;
  amountInAtomic: string;
  userAddress: string;
  verifiedVaultAddress: string;
  requestedFinality?: CctpFinalityMode;
  useForwardingService?: boolean;
  irisBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export type ComputeCctpQuoteOutcome =
  | {
      ok: true;
      route: CctpRoute;
      quoteResponse: VeinPayQuoteResponse;
    }
  | {
      ok: false;
      errorCode:
        | 'UNSUPPORTED_ON_TESTNET'
        | 'INVALID_VAULT_ADDRESS'
        | 'INVALID_AMOUNT'
        | 'AMOUNT_BELOW_FEE'
        | 'SAME_CHAIN_USE_DIRECT';
      message: string;
      quoteResponse: VeinPayQuoteResponse;
    };

/**
 * Queries Circle's Iris V2 fee schedule for the given (sourceDomain, destinationDomain) pair.
 * Falls back to Circle's documented default fee schedule (1 bps for Fast Transfer, 0 bps for Standard)
 * if the sandbox endpoint times out during offline/CI test runs.
 */
export async function fetchCircleCctpFeeSchedule(params: {
  sourceDomain: number;
  destinationDomain: number;
  useForwardingService: boolean;
  irisBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<CircleIrisFeeTier[]> {
  const baseUrl = (params.irisBaseUrl || CIRCLE_IRIS_SANDBOX_BASE_URL).replace(
    /\/+$/,
    ''
  );
  const qs = params.useForwardingService ? '?forward=true' : '';
  const url = `${baseUrl}/v2/burn/USDC/fees/${params.sourceDomain}/${params.destinationDomain}${qs}`;
  const fetcher = params.fetchImpl ?? fetch;

  try {
    const res = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = (await res.json()) as unknown;
      if (Array.isArray(data) && data.length > 0) {
        return data as CircleIrisFeeTier[];
      }
    }
  } catch {
    // Fall through to Circle documented defaults if sandbox network is unreachable
  }

  return [
    {
      finalityThreshold: 1000,
      minimumFee: 1, // 1 bps (0.01%) Fast Transfer fee
      forwardFee: { low: 90, medium: 110, high: 160 },
    },
    {
      finalityThreshold: 2000,
      minimumFee: 0, // 0 bps Standard Transfer fee
      forwardFee: { low: 90, medium: 110, high: 160 },
    },
  ];
}

/**
 * Computes the exact protocol fee in atomic USDC subunits (6 decimals) from basis points (`1 bps = 0.01%`).
 * Uses ceiling integer math so `maxFee` never under-estimates by 1 atomic unit.
 */
export function calculateCctpFeeBreakdown(params: {
  amountInAtomic: bigint;
  protocolFeeBps: number;
  forwardingFeeSubunits: number;
}): {
  protocolFeeAtomic: bigint;
  forwardingFeeAtomic: bigint;
  totalFeeAtomic: bigint;
  maxFeeAtomic: bigint;
  netAmountOutAtomic: bigint;
} {
  if (params.amountInAtomic <= 0n) {
    throw new Error('amountInAtomic must be positive');
  }
  // protocolFeeBps can be integer or decimal (e.g. 1 or 1.5 bps). Scale by 100 -> parts per 1,000,000.
  const scaledBps = BigInt(Math.max(0, Math.round(params.protocolFeeBps * 100)));
  const protocolFeeAtomic =
    scaledBps === 0n
      ? 0n
      : (params.amountInAtomic * scaledBps + 999_999n) / 1_000_000n;

  const forwardingFeeAtomic = BigInt(
    Math.max(0, Math.floor(params.forwardingFeeSubunits))
  );
  const totalFeeAtomic = protocolFeeAtomic + forwardingFeeAtomic;
  const maxFeeAtomic = totalFeeAtomic;
  const netAmountOutAtomic = params.amountInAtomic - totalFeeAtomic;

  return {
    protocolFeeAtomic,
    forwardingFeeAtomic,
    totalFeeAtomic,
    maxFeeAtomic,
    netAmountOutAtomic,
  };
}

export async function computeCctpV2Quote(
  params: ComputeCctpQuoteParams
): Promise<ComputeCctpQuoteOutcome> {
  const startPerf = performance.now();

  const sourceCfg = getCctpChainConfig(params.sourceChainId);
  const destCfg = getCctpChainConfig(params.destinationChainId);

  const makeUnsupported = (
    errorCode:
      | 'UNSUPPORTED_ON_TESTNET'
      | 'INVALID_VAULT_ADDRESS'
      | 'INVALID_AMOUNT'
      | 'AMOUNT_BELOW_FEE'
      | 'SAME_CHAIN_USE_DIRECT',
    message: string
  ): ComputeCctpQuoteOutcome => {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return {
      ok: false,
      errorCode,
      message,
      quoteResponse: {
        success: false,
        statusCode: 400,
        source: 'UNSUPPORTED_ON_TESTNET',
        error: errorCode,
        message,
        fallbackReason: message,
        executionTimeMs: elapsedMs,
        result: {
          originChainId: params.sourceChainId,
          destinationChainId: params.destinationChainId,
          userAddress: params.userAddress,
          receiverAddress: params.verifiedVaultAddress,
          routes: [],
        },
      },
    };
  };

  if (!sourceCfg || !destCfg) {
    return makeUnsupported(
      'UNSUPPORTED_ON_TESTNET',
      `CCTP V2 Testnet only supports Ethereum Sepolia (11155111), OP Sepolia (11155420), Arbitrum Sepolia (421614), Base Sepolia (84532), and Polygon Amoy (80002). Received ${params.sourceChainId} -> ${params.destinationChainId}.`
    );
  }

  // Strictly enforce USDC-only on testnet (never silently substitute another token)
  if (!isTestnetUsdcToken(params.sourceChainId, params.inputToken)) {
    return makeUnsupported(
      'UNSUPPORTED_ON_TESTNET',
      `Token "${params.inputToken}" is unsupported on testnet cross-chain routes. Circle CCTP V2 strictly supports USDC only.`
    );
  }

  if (
    params.outputToken &&
    !isTestnetUsdcToken(params.destinationChainId, params.outputToken)
  ) {
    return makeUnsupported(
      'UNSUPPORTED_ON_TESTNET',
      `Destination token "${params.outputToken}" is unsupported on testnet cross-chain routes. Circle CCTP V2 strictly supports USDC only.`
    );
  }

  if (params.sourceChainId === params.destinationChainId) {
    return makeUnsupported(
      'SAME_CHAIN_USE_DIRECT',
      'Source and destination chains are identical; use SAME_CHAIN_DIRECT transfer instead of CCTP burn-and-mint.'
    );
  }

  if (
    !params.verifiedVaultAddress ||
    !isAddress(params.verifiedVaultAddress.trim(), { strict: false })
  ) {
    return makeUnsupported(
      'INVALID_VAULT_ADDRESS',
      'A verified EVM destination vault address is required for CCTP V2 mintRecipient.'
    );
  }

  let amountInAtomic: bigint;
  try {
    amountInAtomic = BigInt(params.amountInAtomic);
  } catch {
    return makeUnsupported(
      'INVALID_AMOUNT',
      `Invalid atomic USDC amount: "${params.amountInAtomic}"`
    );
  }

  if (amountInAtomic <= 0n) {
    return makeUnsupported(
      'INVALID_AMOUNT',
      'USDC burn amount must be greater than zero.'
    );
  }

  const verifiedVaultChecksum = getAddress(params.verifiedVaultAddress.trim());
  const requestedFinality: CctpFinalityMode =
    params.requestedFinality ?? 'FAST';

  // Handle source chains where Fast Transfer is not available (e.g., Polygon Amoy domain 7)
  const effectiveFinalityMode: CctpFinalityMode =
    requestedFinality === 'FAST' && sourceCfg.fastTransferSupportedAsSource
      ? 'FAST'
      : 'STANDARD';

  const minFinalityThreshold: 1000 | 2000 =
    effectiveFinalityMode === 'FAST' ? 1000 : 2000;

  const useForwardingService =
    params.useForwardingService !== undefined
      ? Boolean(params.useForwardingService && sourceCfg.forwardingSupported)
      : false;

  const feeTiers = await fetchCircleCctpFeeSchedule({
    sourceDomain: sourceCfg.domain,
    destinationDomain: destCfg.domain,
    useForwardingService,
    irisBaseUrl: params.irisBaseUrl,
    fetchImpl: params.fetchImpl,
  });

  const matchingTier =
    feeTiers.find((t) => t.finalityThreshold === minFinalityThreshold) ??
    (minFinalityThreshold === 1000
      ? { finalityThreshold: 1000, minimumFee: 1 }
      : { finalityThreshold: 2000, minimumFee: 0 });

  const protocolFeeBps =
    effectiveFinalityMode === 'STANDARD'
      ? Math.max(0, matchingTier.minimumFee ?? 0)
      : Math.max(0, matchingTier.minimumFee ?? 1);

  const forwardingFeeSubunits = useForwardingService
    ? (matchingTier.forwardFee?.high ??
      matchingTier.forwardFee?.medium ??
      160)
    : 0;

  const feeBreakdown = calculateCctpFeeBreakdown({
    amountInAtomic,
    protocolFeeBps,
    forwardingFeeSubunits,
  });

  if (feeBreakdown.netAmountOutAtomic <= 0n) {
    return makeUnsupported(
      'AMOUNT_BELOW_FEE',
      `Input amount (${params.amountInAtomic}) is not sufficient to cover CCTP fee (${feeBreakdown.totalFeeAtomic.toString()}).`
    );
  }

  const expectedTimeSeconds =
    effectiveFinalityMode === 'FAST' && sourceCfg.fastExpectedSeconds
      ? sourceCfg.fastExpectedSeconds
      : sourceCfg.standardExpectedSeconds;

  const expectedTimeDisplay =
    effectiveFinalityMode === 'FAST' && sourceCfg.fastExpectedDisplay
      ? sourceCfg.fastExpectedDisplay
      : sourceCfg.standardExpectedDisplay;

  const mintRecipientBytes32 = addressToBytes32(verifiedVaultChecksum);

  const burnCalldata = encodeDepositForBurnCalldata({
    amountAtomic: amountInAtomic,
    destinationDomain: destCfg.domain,
    mintRecipientAddress: verifiedVaultChecksum,
    burnTokenAddress: sourceCfg.usdcAddress,
    destinationCallerAddress: null,
    maxFeeAtomic: feeBreakdown.maxFeeAtomic,
    minFinalityThreshold,
    useForwardingService,
  });

  const amountInFormatted = fromAtomicUnits(amountInAtomic.toString(), 6);
  const netAmountOutFormatted = fromAtomicUnits(
    feeBreakdown.netAmountOutAtomic.toString(),
    6
  );
  const feeFormatted = fromAtomicUnits(
    feeBreakdown.totalFeeAtomic.toString(),
    6
  );

  const cctpRoute: CctpRoute = {
    sourceChainId: sourceCfg.chainId,
    destinationChainId: destCfg.chainId,
    sourceDomain: sourceCfg.domain,
    destinationDomain: destCfg.domain,
    amountInAtomic: amountInAtomic.toString(),
    amountInFormatted,
    protocolFeeBps,
    protocolFeeAtomic: feeBreakdown.protocolFeeAtomic.toString(),
    forwardingFeeAtomic: feeBreakdown.forwardingFeeAtomic.toString(),
    totalFeeAtomic: feeBreakdown.totalFeeAtomic.toString(),
    feeFormatted,
    maxFeeAtomic: feeBreakdown.maxFeeAtomic.toString(),
    netAmountOutAtomic: feeBreakdown.netAmountOutAtomic.toString(),
    netAmountOutFormatted,
    expectedTimeSeconds,
    expectedTimeDisplay,
    finalityMode: effectiveFinalityMode,
    minFinalityThreshold,
    fastTransferAvailableOnSource: sourceCfg.fastTransferSupportedAsSource,
    useForwardingService,
    mintRecipientAddress: verifiedVaultChecksum,
    mintRecipientBytes32,
    destinationCallerBytes32: ZERO_BYTES32,
    contracts: {
      usdcSource: sourceCfg.usdcAddress,
      usdcDestination: destCfg.usdcAddress,
      tokenMessengerV2: sourceCfg.tokenMessengerV2,
      messageTransmitterV2: destCfg.messageTransmitterV2,
      tokenMinterV2: destCfg.tokenMinterV2,
    },
    approval: {
      spenderAddress: sourceCfg.tokenMessengerV2,
      amount: amountInAtomic.toString(),
      tokenAddress: sourceCfg.usdcAddress,
      userAddress: params.userAddress,
    },
    burnTxData: {
      chainId: sourceCfg.chainId,
      to: sourceCfg.tokenMessengerV2,
      data: burnCalldata,
      value: '0',
    },
  };

  const bridgeLabel = `Circle CCTP V2 (${effectiveFinalityMode} · Domain ${sourceCfg.domain} → ${destCfg.domain})`;
  const quoteId = `0xcctp_v2_${sourceCfg.domain}_${destCfg.domain}_${amountInAtomic.toString()}`;

  const normalizedRoute: NormalizedSocketRoute = {
    quoteId,
    userOp: 'tx',
    originChainId: sourceCfg.chainId,
    destinationChainId: destCfg.chainId,
    isSameChainDirect: false,
    // V2 compatibility fields (always net amount after fees, real finality time):
    toAmount: feeBreakdown.netAmountOutAtomic.toString(),
    usedBridgeNames: [bridgeLabel],
    serviceTime: expectedTimeSeconds,
    totalGasFeesInUsd: 0.002,
    // Native V3 fields (net amount received by receiver after CCTP fee):
    outputAmountFormatted: `${netAmountOutFormatted} USDC`,
    minAmountOutFormatted: `${netAmountOutFormatted} USDC`,
    outputValueInUsd: Number(netAmountOutFormatted),
    inputAmountFormatted: `${amountInFormatted} USDC`,
    inputValueInUsd: Number(amountInFormatted),
    estimatedTime: expectedTimeSeconds,
    slippage: 0,
    routeTags: [
      'CCTP_V2_TESTNET',
      effectiveFinalityMode === 'FAST'
        ? 'FAST_FINALITY_1000'
        : 'STANDARD_FINALITY_2000',
      ...(useForwardingService ? ['FORWARDING_HOOK'] : ['PERMISSIONLESS_MINT']),
    ],
    bridgeProtocolName: 'circle-cctp-v2',
    bridgeDisplayName: bridgeLabel,
    cctpRoute,
    approval: {
      spenderAddress: sourceCfg.tokenMessengerV2,
      amount: amountInAtomic.toString(),
      tokenAddress: sourceCfg.usdcAddress,
      userAddress: params.userAddress,
    },
    txData: {
      kind: 'evm_tx',
      object: {
        chainId: sourceCfg.chainId,
        to: sourceCfg.tokenMessengerV2,
        data: burnCalldata,
        value: '0',
      },
    },
    gasFee: {
      estimatedFee: '65000000000000',
      feeInUsd: 0.002,
    },
    statusCheckUrl: `/api/cctp/attestation?sourceDomain=${sourceCfg.domain}`,
  };

  const elapsedMs = Number((performance.now() - startPerf).toFixed(2));

  return {
    ok: true,
    route: cctpRoute,
    quoteResponse: {
      success: true,
      statusCode: 200,
      source: 'CCTP_V2_TESTNET',
      executionTimeMs: elapsedMs,
      cctp: cctpRoute,
      result: {
        originChainId: sourceCfg.chainId,
        destinationChainId: destCfg.chainId,
        userAddress: params.userAddress,
        receiverAddress: verifiedVaultChecksum,
        routes: [normalizedRoute],
      },
    },
  };
}
