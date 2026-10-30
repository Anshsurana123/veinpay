import type {
  CctpFinalityMode,
  CctpRoute,
  NormalizedSocketRoute,
  VeilPayQuoteResponse,
} from '@/types/veilpay';
import {
  fromAtomicUnits,
  getChainDisplayName,
  isTestnetChain,
  NATIVE_TOKEN_ADDRESS,
  resolveTokenByAddressOrSymbol,
} from '@/lib/socket/tokens';
import { computeCctpV2Quote } from '@/lib/cctp/quote';
import { isSupportedCctpTestnetChain } from '@/lib/cctp/contracts';

export interface SocketQuoteRequestParams {
  originChainId: number;
  destinationChainId: number;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  userAddress: string;
  receiverAddress: string;
  slippage?: string;
  sort?: 'output' | 'time';
  finalityMode?: CctpFinalityMode;
  useForwardingService?: boolean;
}

interface RawSocketV3Route {
  userOp?: string;
  quoteId?: string;
  expiresAt?: number;
  output?: {
    token?: {
      chainId?: number;
      address?: string;
      symbol?: string;
      decimals?: number;
    };
    amount?: string;
    minAmountOut?: string;
    valueInUsd?: number;
  };
  estimatedTime?: number;
  slippage?: number;
  routeTags?: string[];
  routeDetails?: {
    dexDetails?: {
      protocol?: { name?: string; displayName?: string; icon?: string };
    } | null;
    bridgeDetails?: {
      protocol?: { name?: string; displayName?: string; icon?: string };
    } | null;
  };
  approval?: {
    spenderAddress: string;
    amount: string;
    tokenAddress: string;
    userAddress: string;
  } | null;
  txData?: {
    kind?: string;
    object?: {
      chainId?: number;
      to?: string;
      data?: string;
      value?: string;
    };
  };
  gasFee?: {
    estimatedFee?: string;
    feeInUsd?: number;
  };
  statusCheck?: {
    endpoint?: string;
  };
}

function encodeErc20TransferCalldata(toAddress: string, atomicAmount: string): string {
  // selector for transfer(address,uint256) = 0xa9059cbb
  const cleanAddr = toAddress.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
  let hexAmount = '0'.repeat(64);
  try {
    hexAmount = BigInt(atomicAmount).toString(16).padStart(64, '0');
  } catch {
    hexAmount = (250000000n).toString(16).padStart(64, '0');
  }
  return `0xa9059cbb${cleanAddr}${hexAmount}`;
}

export function buildSameChainDirectRoute(
  params: SocketQuoteRequestParams,
  elapsedMs: number
): VeilPayQuoteResponse {
  const tokenMeta = resolveTokenByAddressOrSymbol(
    params.originChainId,
    params.inputToken
  );
  const humanAmt = fromAtomicUnits(params.inputAmount, tokenMeta.decimals);
  const usdValue = Number(
    (Number(humanAmt) * (tokenMeta.approxUsdPrice ?? 1.0)).toFixed(2)
  );
  const isNative =
    tokenMeta.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();

  const txTo = isNative ? params.receiverAddress : tokenMeta.address;
  const txValue = isNative ? params.inputAmount : '0';
  const txCalldata = isNative
    ? '0x'
    : encodeErc20TransferCalldata(params.receiverAddress, params.inputAmount);

  const chainName = getChainDisplayName(params.originChainId);
  const directRoute: NormalizedSocketRoute = {
    quoteId: `0xdirect_${params.originChainId}_${Date.now().toString(16)}`,
    userOp: 'tx',
    originChainId: params.originChainId,
    destinationChainId: params.destinationChainId,
    isSameChainDirect: true,
    // Brief V2 compatibility fields:
    toAmount: params.inputAmount,
    usedBridgeNames: [`Direct ${chainName} Settlement (Zero Bridge Overhead)`],
    serviceTime: 1,
    totalGasFeesInUsd: 0.001,
    // Native V3 fields:
    outputAmountFormatted: `${humanAmt} ${tokenMeta.symbol}`,
    minAmountOutFormatted: `${humanAmt} ${tokenMeta.symbol}`,
    outputValueInUsd: usdValue,
    inputAmountFormatted: `${humanAmt} ${tokenMeta.symbol}`,
    inputValueInUsd: usdValue,
    estimatedTime: 1,
    slippage: 0,
    routeTags: ['SAME_CHAIN_DIRECT', 'ZERO_SLIPPAGE'],
    bridgeProtocolName: 'direct-settlement',
    bridgeDisplayName: `Direct ${chainName} Settlement (Zero Bridge Overhead)`,
    approval: null,
    txData: {
      kind: 'evm_tx',
      object: {
        chainId: params.originChainId,
        to: txTo,
        data: txCalldata,
        value: txValue,
      },
    },
    gasFee: {
      estimatedFee: '2100000000000',
      feeInUsd: 0.001,
    },
    statusCheckUrl: '',
  };

  return {
    success: true,
    statusCode: 200,
    source: 'SAME_CHAIN_DIRECT',
    executionTimeMs: elapsedMs,
    result: {
      originChainId: params.originChainId,
      destinationChainId: params.destinationChainId,
      userAddress: params.userAddress,
      receiverAddress: params.receiverAddress,
      routes: [directRoute],
    },
  };
}

export function buildDeterministicFallbackQuote(
  params: SocketQuoteRequestParams,
  fallbackReason: string,
  elapsedMs: number
): VeilPayQuoteResponse {
  const inMeta = resolveTokenByAddressOrSymbol(
    params.originChainId,
    params.inputToken
  );
  const outMeta = resolveTokenByAddressOrSymbol(
    params.destinationChainId,
    params.outputToken
  );

  const inHuman = Number(fromAtomicUnits(params.inputAmount, inMeta.decimals));
  const inputUsd = Number(
    (inHuman * (inMeta.approxUsdPrice ?? 1.0)).toFixed(2)
  );
  const netUsdAfterBridgeFee = Number((inputUsd * 0.9979).toFixed(2));
  const outHuman = Number(
    (netUsdAfterBridgeFee / (outMeta.approxUsdPrice ?? 1.0)).toFixed(
      outMeta.decimals === 6 ? 6 : 5
    )
  );
  const outAtomic = BigInt(
    Math.max(1, Math.floor(outHuman * 10 ** Math.min(outMeta.decimals, 6)))
  ) *
    (outMeta.decimals > 6 ? 10n ** BigInt(outMeta.decimals - 6) : 1n);

  const minOutAtomic = (outAtomic * 99n) / 100n;
  const quoteId =
    '0x226b741020d28c9ed574e3ce13115ca3f450dd79e7ed3c3622f3b521f922960c';

  const fallbackRoute: NormalizedSocketRoute = {
    quoteId,
    userOp: 'tx',
    originChainId: params.originChainId,
    destinationChainId: params.destinationChainId,
    isSameChainDirect: false,
    // Brief V2 compatibility fields:
    toAmount: outAtomic.toString(),
    usedBridgeNames: ['Socket Intents (Bungee RFQ)'],
    serviceTime: 3,
    totalGasFeesInUsd: 0.003,
    // Native V3 fields:
    outputAmountFormatted: `${fromAtomicUnits(outAtomic.toString(), outMeta.decimals)} ${outMeta.symbol}`,
    minAmountOutFormatted: `${fromAtomicUnits(minOutAtomic.toString(), outMeta.decimals)} ${outMeta.symbol}`,
    outputValueInUsd: netUsdAfterBridgeFee,
    inputAmountFormatted: `${inHuman} ${inMeta.symbol}`,
    inputValueInUsd: inputUsd,
    estimatedTime: 3,
    slippage: 1,
    routeTags: ['ESTIMATE_ONLY', 'FALLBACK_DETERMINISTIC'],
    bridgeProtocolName: 'estimate-fallback',
    bridgeDisplayName: 'Socket Intents (Estimate Only)',
    bridgeIcon: 'https://media.socket.tech/bridges/socket-icon.png',
    approval: null,
    gasFee: {
      estimatedFee: '10028000000000',
      feeInUsd: 0.003,
    },
    statusCheckUrl: `https://public-backend.socket.tech/v3/swap/status?quoteId=${quoteId}`,
  };

  return {
    success: false,
    statusCode: 503,
    source: 'FALLBACK_DETERMINISTIC',
    fallbackReason,
    executionTimeMs: elapsedMs,
    result: {
      originChainId: params.originChainId,
      destinationChainId: params.destinationChainId,
      userAddress: params.userAddress,
      receiverAddress: params.receiverAddress,
      routes: [fallbackRoute],
    },
  };
}

export function buildUnsupportedTestnetQuote(
  params: SocketQuoteRequestParams,
  reason: string,
  elapsedMs: number
): VeilPayQuoteResponse {
  return {
    success: false,
    statusCode: 400,
    source: 'UNSUPPORTED_ON_TESTNET',
    fallbackReason: reason,
    executionTimeMs: elapsedMs,
    result: {
      originChainId: params.originChainId,
      destinationChainId: params.destinationChainId,
      userAddress: params.userAddress,
      receiverAddress: params.receiverAddress,
      routes: [],
    },
  };
}

export function buildCctpV2QuoteResponse(
  params: SocketQuoteRequestParams,
  cctpRoute: CctpRoute,
  elapsedMs: number
): VeilPayQuoteResponse {
  const originName = getChainDisplayName(params.originChainId);
  const destName = getChainDisplayName(params.destinationChainId);
  const bridgeDisplayName = `Circle CCTP V2 (${cctpRoute.finalityMode} · ${originName} Domain ${cctpRoute.sourceDomain} → ${destName} Domain ${cctpRoute.destinationDomain})`;
  const netUsd = Number(Number(cctpRoute.netAmountOutFormatted).toFixed(2));
  const grossUsd = Number(Number(cctpRoute.amountInFormatted).toFixed(2));
  const quoteId = `0xcctp_v2_${cctpRoute.sourceDomain}_${cctpRoute.destinationDomain}_${cctpRoute.amountInAtomic}`;

  const normalizedRoute: NormalizedSocketRoute = {
    quoteId,
    userOp: 'tx',
    originChainId: cctpRoute.sourceChainId,
    destinationChainId: cctpRoute.destinationChainId,
    isSameChainDirect: false,
    toAmount: cctpRoute.netAmountOutAtomic,
    usedBridgeNames: [bridgeDisplayName],
    serviceTime: cctpRoute.expectedTimeSeconds,
    totalGasFeesInUsd: 0.02,
    outputAmountFormatted: `${cctpRoute.netAmountOutFormatted} USDC`,
    minAmountOutFormatted: `${cctpRoute.netAmountOutFormatted} USDC`,
    outputValueInUsd: netUsd,
    inputAmountFormatted: `${cctpRoute.amountInFormatted} USDC`,
    inputValueInUsd: grossUsd,
    estimatedTime: cctpRoute.expectedTimeSeconds,
    slippage: 0,
    routeTags: [
      'CCTP_V2_TESTNET',
      cctpRoute.finalityMode === 'FAST' ? 'FAST_ATTESTATION' : 'STANDARD_FINALITY',
    ],
    bridgeProtocolName: 'circle-cctp-v2',
    bridgeDisplayName,
    cctpRoute,
    approval: cctpRoute.approval,
    txData: {
      kind: 'evm_tx',
      object: cctpRoute.burnTxData,
    },
    gasFee: {
      estimatedFee: '85000000000000',
      feeInUsd: 0.02,
    },
    statusCheckUrl: `/api/cctp/attestation?sourceDomain=${cctpRoute.sourceDomain}`,
  };

  return {
    success: true,
    statusCode: 200,
    source: 'CCTP_V2_TESTNET',
    cctp: cctpRoute,
    cctpRoute,
    executionTimeMs: elapsedMs,
    result: {
      originChainId: cctpRoute.sourceChainId,
      destinationChainId: cctpRoute.destinationChainId,
      userAddress: params.userAddress,
      receiverAddress: params.receiverAddress,
      routes: [normalizedRoute],
    },
  };
}

export async function fetchSocketCrossChainQuote(
  params: SocketQuoteRequestParams
): Promise<VeilPayQuoteResponse> {
  const startPerf = performance.now();

  let inMeta;
  let outMeta;
  try {
    inMeta = resolveTokenByAddressOrSymbol(
      params.originChainId,
      params.inputToken
    );
    outMeta = resolveTokenByAddressOrSymbol(
      params.destinationChainId,
      params.outputToken
    );
  } catch (err) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return buildUnsupportedTestnetQuote(
      params,
      err instanceof Error ? err.message : 'Unsupported token or chain selection.',
      elapsedMs
    );
  }

  // Testnet routing rules (Issue 1 / T1):
  // - Never silently substitute a token or build a fake cross-chain ERC-20 transfer.
  // - Same chain (origin == destination): direct transfer (USDC or native ETH only on testnet), labeled SAME_CHAIN_DIRECT with tx.chainId == destinationChainId.
  // - Different chains on testnet: USDC only via real Circle CCTP V2 burn-and-mint flow ('CCTP_V2_TESTNET').
  // - Non-USDC on testnet cross-chain (or mainnet<->testnet mix): explicit 'UNSUPPORTED_ON_TESTNET' error.
  if (
    isTestnetChain(params.originChainId) ||
    isTestnetChain(params.destinationChainId)
  ) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));

    if (
      !isTestnetChain(params.originChainId) ||
      !isTestnetChain(params.destinationChainId)
    ) {
      return buildUnsupportedTestnetQuote(
        params,
        'Cannot bridge between mainnet and testnet chains.',
        elapsedMs
      );
    }

    if (params.originChainId === params.destinationChainId) {
      if (
        inMeta.symbol !== outMeta.symbol ||
        (inMeta.symbol !== 'USDC' && inMeta.symbol !== 'ETH')
      ) {
        return buildUnsupportedTestnetQuote(
          params,
          `Token ${inMeta.symbol} -> ${outMeta.symbol} is unsupported on testnet. Same-chain testnet transfers support direct USDC or native ETH only.`,
          elapsedMs
        );
      }

      return buildSameChainDirectRoute(
        {
          ...params,
          destinationChainId: params.originChainId,
          inputToken: inMeta.address,
          outputToken: outMeta.address,
        },
        elapsedMs
      );
    }

    // Cross-chain on testnet: strictly USDC only via Circle CCTP V2
    if (inMeta.symbol !== 'USDC' || outMeta.symbol !== 'USDC') {
      return buildUnsupportedTestnetQuote(
        params,
        `Cross-chain testnet routing supports USDC only via Circle CCTP V2. Selected ${inMeta.symbol} -> ${outMeta.symbol} is unsupported on testnet.`,
        elapsedMs
      );
    }

    if (
      !isSupportedCctpTestnetChain(params.originChainId) ||
      !isSupportedCctpTestnetChain(params.destinationChainId)
    ) {
      return buildUnsupportedTestnetQuote(
        params,
        `Chain pair ${params.originChainId} -> ${params.destinationChainId} is not supported by Circle CCTP V2 Testnet.`,
        elapsedMs
      );
    }

    const outcome = await computeCctpV2Quote({
      sourceChainId: params.originChainId,
      destinationChainId: params.destinationChainId,
      inputToken: inMeta.address,
      outputToken: outMeta.address,
      amountInAtomic: params.inputAmount,
      userAddress: params.userAddress,
      verifiedVaultAddress: params.receiverAddress,
      requestedFinality: params.finalityMode ?? 'FAST',
      useForwardingService: params.useForwardingService ?? false,
    });
    const totalElapsed = Number((performance.now() - startPerf).toFixed(2));
    if (!outcome.ok) {
      return buildUnsupportedTestnetQuote(params, outcome.message, totalElapsed);
    }
    return buildCctpV2QuoteResponse(params, outcome.route, totalElapsed);
  }

  // Scenario 5B: Same-Chain & Same-Token Direct Transfer on Mainnet (skip bridging overhead)
  if (
    params.originChainId === params.destinationChainId &&
    inMeta.address.toLowerCase() === outMeta.address.toLowerCase()
  ) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return buildSameChainDirectRoute(
      {
        ...params,
        inputToken: inMeta.address,
        outputToken: outMeta.address,
      },
      elapsedMs
    );
  }

  // Scenario 5A: Cross-Chain or Cross-Token Swap via Socket Swap V3 API
  const dedicatedKey = process.env.SOCKET_API_KEY?.trim();
  const affiliateId = process.env.SOCKET_AFFILIATE_ID?.trim();
  const baseUrl =
    dedicatedKey && affiliateId
      ? 'https://dedicated-backend.socket.tech'
      : 'https://public-backend.socket.tech';

  const query = new URLSearchParams({
    userOps: 'tx',
    originChainId: String(params.originChainId),
    destinationChainId: String(params.destinationChainId),
    inputToken: inMeta.address,
    outputToken: outMeta.address,
    inputAmount: params.inputAmount,
    userAddress: params.userAddress,
    receiverAddress: params.receiverAddress,
    slippage: params.slippage || '1',
  });

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (dedicatedKey && affiliateId) {
    headers['x-api-key'] = dedicatedKey;
    headers['affiliate'] = affiliateId;
  }

  try {
    // Enforce 3500ms timeout for resilient public API & offline fallback
    const timeoutMs =
      Number(process.env.SOCKET_TIMEOUT_MS) > 0
        ? Number(process.env.SOCKET_TIMEOUT_MS)
        : 3500;
    const response = await fetch(`${baseUrl}/v3/swap/quote?${query.toString()}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));

    if (!response.ok) {
      return buildDeterministicFallbackQuote(
        { ...params, inputToken: inMeta.address, outputToken: outMeta.address },
        `Socket V3 returned HTTP ${response.status}`,
        elapsedMs
      );
    }

    const payload = (await response.json()) as {
      success?: boolean;
      statusCode?: number;
      result?: {
        originChainId?: number;
        destinationChainId?: number;
        userAddress?: string;
        receiverAddress?: string;
        input?: { amount?: string; valueInUsd?: number; token?: { decimals?: number; symbol?: string } };
        routes?: RawSocketV3Route[];
      };
    };

    const rawRoutes = payload.result?.routes;
    if (!payload.success || !Array.isArray(rawRoutes) || rawRoutes.length === 0) {
      return buildDeterministicFallbackQuote(
        { ...params, inputToken: inMeta.address, outputToken: outMeta.address },
        'Socket V3 returned 0 available routes for pair',
        elapsedMs
      );
    }

    // Verify Socket didn't divert the destination receiver vault address
    if (
      payload.result?.receiverAddress &&
      payload.result.receiverAddress.toLowerCase() !==
        params.receiverAddress.toLowerCase()
    ) {
      return {
        success: false,
        statusCode: 502,
        source: 'SOCKET_V3_LIVE',
        fallbackReason: `Security Intercept: Socket API returned receiverAddress (${payload.result.receiverAddress}) which diverges from authoritative verified receiver vault (${params.receiverAddress}).`,
        executionTimeMs: elapsedMs,
        result: {
          originChainId: params.originChainId,
          destinationChainId: params.destinationChainId,
          userAddress: params.userAddress,
          receiverAddress: params.receiverAddress,
          routes: [],
        },
      };
    }

    const inDecimals = payload.result?.input?.token?.decimals ?? inMeta.decimals;
    const inSymbol = payload.result?.input?.token?.symbol ?? inMeta.symbol;
    const inHuman = fromAtomicUnits(params.inputAmount, inDecimals);
    const inUsd =
      payload.result?.input?.valueInUsd ??
      Number(
        (Number(inHuman) * (inMeta.approxUsdPrice ?? 1.0)).toFixed(2)
      );

    const normalizedRoutes: NormalizedSocketRoute[] = rawRoutes.map((r, idx) => {
      // Validate calldata recipient does not divert from authoritative verified receiver vault
      if (r.txData?.object?.data && r.txData.object.data.startsWith('0xa9059cbb') && r.txData.object.data.length >= 74) {
        const calldataRecipient = '0x' + r.txData.object.data.slice(34, 74).toLowerCase();
        if (calldataRecipient !== params.receiverAddress.toLowerCase()) {
          throw new Error(
            `Security Intercept: Socket router calldata recipient (${calldataRecipient}) diverged from verified vault (${params.receiverAddress}).`
          );
        }
      }

      const outDecimals = r.output?.token?.decimals ?? outMeta.decimals;
      const outSymbol = r.output?.token?.symbol ?? outMeta.symbol;
      const toAmountStr = r.output?.amount ?? params.inputAmount;
      const minOutStr = r.output?.minAmountOut ?? toAmountStr;
      const outHumanStr = fromAtomicUnits(toAmountStr, outDecimals);
      const minOutHumanStr = fromAtomicUnits(minOutStr, outDecimals);

      const bridgeProto =
        r.routeDetails?.bridgeDetails?.protocol ??
        r.routeDetails?.dexDetails?.protocol;
      const bridgeDisplayName =
        bridgeProto?.displayName ?? bridgeProto?.name ?? 'Socket Intents (Bungee)';
      const bridgeProtocolName = bridgeProto?.name ?? 'socket-v3';
      const serviceTime = r.estimatedTime ?? 3;
      const gasUsd = r.gasFee?.feeInUsd ?? 0.003;
      const quoteId = r.quoteId ?? `0xsocket_v3_${idx}`;

      return {
        quoteId,
        userOp: r.userOp ?? 'tx',
        originChainId: params.originChainId,
        destinationChainId: params.destinationChainId,
        isSameChainDirect: false,
        // Brief V2 compatibility fields:
        toAmount: toAmountStr,
        usedBridgeNames: [bridgeDisplayName],
        serviceTime,
        totalGasFeesInUsd: gasUsd,
        // Native V3 fields:
        outputAmountFormatted: `${outHumanStr} ${outSymbol}`,
        minAmountOutFormatted: `${minOutHumanStr} ${outSymbol}`,
        outputValueInUsd:
          r.output?.valueInUsd ??
          Number(
            (Number(outHumanStr) * (outMeta.approxUsdPrice ?? 1.0)).toFixed(2)
          ),
        inputAmountFormatted: `${inHuman} ${inSymbol}`,
        inputValueInUsd: inUsd,
        estimatedTime: serviceTime,
        slippage: r.slippage ?? 1,
        routeTags: r.routeTags ?? [],
        bridgeProtocolName,
        bridgeDisplayName,
        bridgeIcon: bridgeProto?.icon,
        approval: r.approval ?? null,
        txData: {
          kind: r.txData?.kind ?? 'evm_tx',
          object: {
            chainId: r.txData?.object?.chainId ?? params.originChainId,
            to:
              r.txData?.object?.to ??
              '0x50c4E75a512F2A14A7b304787Adf79C4531A5909',
            data: r.txData?.object?.data ?? '0x',
            value: r.txData?.object?.value ?? '0',
          },
        },
        gasFee: {
          estimatedFee: r.gasFee?.estimatedFee ?? '10028000000000',
          feeInUsd: gasUsd,
        },
        statusCheckUrl:
          r.statusCheck?.endpoint ??
          `${baseUrl}/v3/swap/status?quoteId=${quoteId}`,
      };
    });

    if (params.sort === 'time') {
      normalizedRoutes.sort((a, b) => a.serviceTime - b.serviceTime);
    }

    return {
      success: true,
      statusCode: 200,
      source: 'SOCKET_V3_LIVE',
      executionTimeMs: elapsedMs,
      result: {
        originChainId: params.originChainId,
        destinationChainId: params.destinationChainId,
        userAddress: params.userAddress,
        receiverAddress: params.receiverAddress,
        routes: normalizedRoutes,
      },
    };
  } catch (err) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    const reason =
      err instanceof Error
        ? `Network/Timeout fallback (${err.message})`
        : 'Socket V3 request timed out after 3500ms';
    return buildDeterministicFallbackQuote(
      { ...params, inputToken: inMeta.address, outputToken: outMeta.address },
      reason,
      elapsedMs
    );
  }
}
