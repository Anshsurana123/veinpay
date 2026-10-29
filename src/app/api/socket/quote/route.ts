import { NextRequest, NextResponse } from 'next/server';
import { runFullScan } from '@/lib/graph/full-scan';
import { resolveVerifiedLinkAuthority } from '@/lib/links';
import { verifyScanAttestation } from '@/lib/security/attestation';
import { fetchSocketCrossChainQuote } from '@/lib/socket/client';
import { EVM_TOKEN_REGISTRY, isTestnetChain } from '@/lib/socket/tokens';
import {
  buildRateLimitExceededResponse,
  checkRateLimit,
  getClientIp,
} from '@/lib/security/rate-limit';

function isUsdtInput(tokenStr: string): boolean {
  const t = tokenStr.trim().toUpperCase();
  if (t === 'USDT') return true;
  const lower = tokenStr.trim().toLowerCase();
  return Object.values(EVM_TOKEN_REGISTRY.USDT.addressesByChain).some(
    (a) => a && a.toLowerCase() === lower
  );
}

async function executeGatedQuoteRequest(params: {
  originChainId: number;
  destinationChainId: number;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  userAddress: string;
  linkId: string;
  c?: string | null;
  sig?: string | null;
  scanAttestation: string | null;
  slippage?: string;
  sort?: 'output' | 'time';
}) {
  // 1. Load authoritative policy and vault ONLY from the verified link (never from client query/body)
  const authority = await resolveVerifiedLinkAuthority({
    linkId: params.linkId,
    c: params.c,
    sig: params.sig,
  });

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

  const authoritativePolicy = authority.policy;
  const authoritativeReceiver = authority.vaultAddress;

  // Reject USDT on testnet chains per Issue 10
  if (
    (isTestnetChain(params.originChainId) && isUsdtInput(params.inputToken)) ||
    (isTestnetChain(params.destinationChainId) && isUsdtInput(params.outputToken))
  ) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 400,
        error: 'USDT_UNSUPPORTED_ON_TESTNET',
        message:
          'USDT is not supported on testnet chains. Only USDC and ETH are supported on testnet.',
      },
      { status: 400 }
    );
  }

  // 2. Verify short-lived server scanAttestation & require proofOfControl === true
  const attestationCheck = verifyScanAttestation(params.scanAttestation, {
    payer: params.userAddress,
    linkId: authority.linkId,
    policy: authoritativePolicy,
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
          'Valid server scanAttestation with proofOfControl=true is required to request a quote.',
      },
      { status: 403 }
    );
  }

  // 3. Re-execute shared server-side runFullScan() (RESTPP -> seeded -> live crawl)
  // using the authoritative link policy and vault
  const { scan, receipt } = await runFullScan({
    targetWallet: params.userAddress,
    merchantWallet: authoritativeReceiver,
    chainId: params.originChainId,
    policy: authoritativePolicy,
  });

  if (!scan.socketUnlocked) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 403,
        error: 'FIREWALL_INTERCEPTED',
        message: `SOCKET transaction builder locked by VeilPay ${scan.maxHopsQueried}-Hop Graph Firewall (${scan.verdict}).`,
        verdict: scan.verdict,
        receipt,
      },
      { status: 403 }
    );
  }

  const quoteResponse = await fetchSocketCrossChainQuote({
    originChainId: params.originChainId,
    destinationChainId: params.destinationChainId,
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    userAddress: params.userAddress,
    receiverAddress: authoritativeReceiver,
    slippage: params.slippage,
    sort: params.sort,
  });

  return NextResponse.json(quoteResponse, {
    status: quoteResponse.statusCode || 200,
  });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('socket-quote', ip, {
    limit: 35,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  const sp = request.nextUrl.searchParams;

  const originChainId = Number(
    sp.get('originChainId') || sp.get('fromChainId') || 42161
  );
  const destinationChainId = Number(
    sp.get('destinationChainId') || sp.get('toChainId') || 8453
  );
  const inputToken =
    sp.get('inputToken') ||
    sp.get('fromTokenAddress') ||
    EVM_TOKEN_REGISTRY.USDC.addressesByChain[42161]!;
  const outputToken =
    sp.get('outputToken') ||
    sp.get('toTokenAddress') ||
    EVM_TOKEN_REGISTRY.USDC.addressesByChain[8453]!;
  const inputAmount =
    sp.get('inputAmount') || sp.get('fromAmount') || '250000000';
  const userAddress =
    sp.get('userAddress') || '0x4F2a9c117034e8B1200499A1c3f88200000188E1';
  const linkId = (sp.get('linkId') || 'default').trim() || 'default';
  const scanAttestation =
    sp.get('scanAttestation') ||
    request.headers.get('x-veilpay-scan-attestation');

  // Policy and receiver vault are loaded strictly from the verified link (never from query string)
  return executeGatedQuoteRequest({
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    inputAmount,
    userAddress,
    linkId,
    c: sp.get('c'),
    sig: sp.get('sig'),
    scanAttestation,
    slippage: sp.get('slippage') || '1',
    sort: sp.get('sort') === 'time' ? 'time' : 'output',
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('socket-quote', ip, {
    limit: 35,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const originChainId = Number(
      body.originChainId ?? body.fromChainId ?? 42161
    );
    const destinationChainId = Number(
      body.destinationChainId ?? body.toChainId ?? 8453
    );
    const inputToken = String(
      body.inputToken ??
        body.fromTokenAddress ??
        EVM_TOKEN_REGISTRY.USDC.addressesByChain[42161]
    );
    const outputToken = String(
      body.outputToken ??
        body.toTokenAddress ??
        EVM_TOKEN_REGISTRY.USDC.addressesByChain[8453]
    );
    const inputAmount = String(
      body.inputAmount ?? body.fromAmount ?? '250000000'
    );
    const userAddress = String(
      body.userAddress ?? '0x4F2a9c117034e8B1200499A1c3f88200000188E1'
    );
    const linkId = String(body.linkId ?? 'default').trim() || 'default';
    const c = typeof body.c === 'string' ? body.c : null;
    const sig = typeof body.sig === 'string' ? body.sig : null;
    const scanAttestation =
      typeof body.scanAttestation === 'string'
        ? body.scanAttestation
        : request.headers.get('x-veilpay-scan-attestation');

    // Policy and receiver vault are loaded strictly from the verified link (never from request body)
    return executeGatedQuoteRequest({
      originChainId,
      destinationChainId,
      inputToken,
      outputToken,
      inputAmount,
      userAddress,
      linkId,
      c,
      sig,
      scanAttestation,
      slippage: String(body.slippage ?? '1'),
      sort: body.sort === 'time' ? 'time' : 'output',
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 400,
        error: err instanceof Error ? err.message : 'Invalid SOCKET quote request',
      },
      { status: 400 }
    );
  }
}
