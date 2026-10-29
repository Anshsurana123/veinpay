import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import {
  buildCctpV2QuoteResponse,
  buildSameChainDirectRoute,
  buildUnsupportedTestnetQuote,
  SocketQuoteRequestParams,
} from '@/lib/socket/client';
import { computeCctpV2Quote } from '@/lib/cctp/quote';
import { isSupportedCctpTestnetChain } from '@/lib/cctp/contracts';
import { runFullScan } from '@/lib/graph/full-scan';
import { resolveVerifiedLinkAuthority } from '@/lib/links';
import { verifyScanAttestation } from '@/lib/security/attestation';
import { isTestnetChain, resolveTokenByAddressOrSymbol } from '@/lib/socket/tokens';
import { CctpFinalityMode } from '@/types/veilpay';

export async function GET(request: NextRequest) {
  const startPerf = performance.now();
  const { searchParams } = new URL(request.url);

  const originChainId = Number(
    searchParams.get('originChainId') ?? searchParams.get('fromChainId') ?? '84532'
  );
  const destinationChainId = Number(
    searchParams.get('destinationChainId') ?? searchParams.get('toChainId') ?? '421614'
  );
  const inputToken = (
    searchParams.get('inputToken') ??
    searchParams.get('tokenSymbol') ??
    'USDC'
  ).trim();
  const outputToken = (
    searchParams.get('outputToken') ??
    searchParams.get('tokenSymbol') ??
    'USDC'
  ).trim();
  const inputAmount = (
    searchParams.get('inputAmount') ??
    searchParams.get('fromAmount') ??
    '25000000'
  ).trim();
  const userAddress = (searchParams.get('userAddress') ?? '').trim();
  const linkId = (searchParams.get('linkId') ?? 'default').trim() || 'default';
  const c = searchParams.get('c');
  const sig = searchParams.get('sig');
  const scanAttestation =
    searchParams.get('scanAttestation') ??
    request.headers.get('x-veilpay-scan-attestation');
  const finalityModeParam = (searchParams.get('finalityMode') ?? 'FAST').toUpperCase();
  const useForwardingService = searchParams.get('useForwardingService') === 'true';

  // Load policy and destination vault ONLY from the verified link authority (never from client query string)
  const authority = await resolveVerifiedLinkAuthority({ linkId, c, sig });
  if (!authority.ok || !authority.vaultAddress) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 403,
        error: authority.errorCode ?? 'INVALID_SIGNED_LINK',
        message:
          authority.reason ??
          'Verified signed payment link is required to resolve policy and destination vault.',
      },
      { status: 403 }
    );
  }

  const receiverAddress = authority.vaultAddress;

  const baseParams: SocketQuoteRequestParams = {
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    inputAmount,
    userAddress,
    receiverAddress,
    finalityMode: finalityModeParam === 'STANDARD' ? 'STANDARD' : 'FAST',
    useForwardingService,
  };

  if (!isAddress(userAddress) || !isAddress(receiverAddress)) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return NextResponse.json(
      buildUnsupportedTestnetQuote(
        baseParams,
        'Valid userAddress and verified link EVM vaultAddress are required.',
        elapsedMs
      ),
      { status: 400 }
    );
  }

  // Enforce server scanAttestation + proofOfControl + runFullScan() gate
  const attestationCheck = verifyScanAttestation(scanAttestation, {
    payer: userAddress,
    linkId: authority.linkId,
    policy: authority.policy,
    requireProofOfControl: true,
  });

  if (!attestationCheck.valid || !attestationCheck.payload?.proofOfControl) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 403,
        error: 'ATTESTATION_OR_PROOF_OF_CONTROL_REQUIRED',
        message:
          attestationCheck.reason ??
          'Valid server scanAttestation with proofOfControl=true is required to build a CCTP V2 route.',
      },
      { status: 403 }
    );
  }

  const { scan, receipt } = await runFullScan({
    targetWallet: userAddress,
    merchantWallet: receiverAddress,
    chainId: originChainId,
    policy: authority.policy,
  });

  if (!scan.socketUnlocked) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 403,
        error: 'FIREWALL_INTERCEPTED',
        message: `CCTP V2 route locked by VeilPay ${scan.maxHopsQueried}-Hop Graph Firewall (${scan.verdict}).`,
        verdict: scan.verdict,
        receipt,
      },
      { status: 403 }
    );
  }

  if (!isTestnetChain(originChainId) || !isTestnetChain(destinationChainId)) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return NextResponse.json(
      buildUnsupportedTestnetQuote(
        baseParams,
        'CCTP V2 testnet quote endpoint only supports testnet chains (11155111, 11155420, 421614, 84532, 80002).',
        elapsedMs
      ),
      { status: 400 }
    );
  }

  if (!/^\d+$/.test(inputAmount) || BigInt(inputAmount) <= BigInt(0)) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return NextResponse.json(
      buildUnsupportedTestnetQuote(
        baseParams,
        'inputAmount must be a positive integer string in atomic units.',
        elapsedMs
      ),
      { status: 400 }
    );
  }

  let inMeta;
  let outMeta;
  try {
    inMeta = resolveTokenByAddressOrSymbol(originChainId, inputToken);
    outMeta = resolveTokenByAddressOrSymbol(destinationChainId, outputToken);
  } catch (err) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return NextResponse.json(
      buildUnsupportedTestnetQuote(
        baseParams,
        err instanceof Error ? err.message : 'Unsupported token on testnet.',
        elapsedMs
      ),
      { status: 400 }
    );
  }

  if (originChainId === destinationChainId) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    if (
      inMeta.symbol !== outMeta.symbol ||
      (inMeta.symbol !== 'USDC' && inMeta.symbol !== 'ETH')
    ) {
      return NextResponse.json(
        buildUnsupportedTestnetQuote(
          baseParams,
          `Token ${inMeta.symbol} is unsupported on testnet. Only direct USDC or native ETH transfers are supported on the same chain.`,
          elapsedMs
        ),
        { status: 400 }
      );
    }

    return NextResponse.json(
      buildSameChainDirectRoute(
        {
          ...baseParams,
          destinationChainId: originChainId,
          inputToken: inMeta.address,
          outputToken: outMeta.address,
        },
        elapsedMs
      ),
      { status: 200 }
    );
  }

  if (inMeta.symbol !== 'USDC' || outMeta.symbol !== 'USDC') {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return NextResponse.json(
      buildUnsupportedTestnetQuote(
        baseParams,
        `Cross-chain testnet routing supports USDC only via Circle CCTP V2. Selected ${inMeta.symbol} -> ${outMeta.symbol} is unsupported on testnet.`,
        elapsedMs
      ),
      { status: 400 }
    );
  }

  if (
    !isSupportedCctpTestnetChain(originChainId) ||
    !isSupportedCctpTestnetChain(destinationChainId)
  ) {
    const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
    return NextResponse.json(
      buildUnsupportedTestnetQuote(
        baseParams,
        `Chain pair ${originChainId} -> ${destinationChainId} is not supported by Circle CCTP V2 Testnet.`,
        elapsedMs
      ),
      { status: 400 }
    );
  }

  const requestedFinality: CctpFinalityMode =
    finalityModeParam === 'STANDARD' ? 'STANDARD' : 'FAST';
  const outcome = await computeCctpV2Quote({
    sourceChainId: originChainId,
    destinationChainId,
    inputToken: inMeta.address,
    outputToken: outMeta.address,
    amountInAtomic: inputAmount,
    userAddress,
    verifiedVaultAddress: receiverAddress,
    requestedFinality,
    useForwardingService,
  });

  const elapsedMs = Number((performance.now() - startPerf).toFixed(2));
  if (!outcome.ok) {
    return NextResponse.json(
      buildUnsupportedTestnetQuote(baseParams, outcome.message, elapsedMs),
      { status: 400 }
    );
  }

  return NextResponse.json(
    buildCctpV2QuoteResponse(baseParams, outcome.route, elapsedMs),
    { status: 200 }
  );
}
