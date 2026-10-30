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
import {
  socketQuoteQuerySchema,
  validateWithZod,
} from '@/lib/validation/schemas';

export const maxDuration = 30;

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
  scanAttestation?: string | null;
  slippage?: string;
  sort?: 'output' | 'time';
}) {
  // 1. Load authoritative policy and vault ONLY from the verified link (never from client query/body)
  const authority = await resolveVerifiedLinkAuthority({
    linkId: params.linkId,
    c: params.c,
    sig: params.sig,
  });

  if (!authority.ok || !authority.vaultAddress || !authority.signer) {
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

  // Enforce invoice amount if link is NOT openAmount (P1-8)
  if (authority.amount && !authority.openAmount) {
    const rawInvoice = parseFloat(authority.amount);
    const invoiceHuman = rawInvoice >= 100_000 ? rawInvoice / 1e6 : rawInvoice;
    const inputHuman = parseFloat(params.inputAmount) / 1e6;
    if (!isNaN(invoiceHuman) && !isNaN(inputHuman) && inputHuman < invoiceHuman) {
      return NextResponse.json(
        {
          success: false,
          statusCode: 400,
          error: 'AMOUNT_BELOW_INVOICE',
          message: `Requested quote amount (${inputHuman} ${authority.asset || 'USDC'}) is below the required invoice amount (${invoiceHuman} ${authority.asset || 'USDC'}).`,
        },
        { status: 400 }
      );
    }
  }

  // Enforce authoritative destinationChainId from verified payment link
  const authoritativeDestinationChainId =
    authority.destinationChainId ?? params.destinationChainId;
  if (
    authority.destinationChainId &&
    params.destinationChainId !== authority.destinationChainId
  ) {
    return NextResponse.json(
      {
        success: false,
        statusCode: 400,
        error: 'DESTINATION_CHAIN_MISMATCH',
        message: `Requested quote destinationChainId (${params.destinationChainId}) does not match payment link's authoritative destination chain (${authority.destinationChainId}).`,
      },
      { status: 400 }
    );
  }

  // Enforce authoritative outputToken if the link specifies an asset (e.g. USDC)
  let authoritativeOutputToken = params.outputToken;
  if (authority.asset && authority.asset in EVM_TOKEN_REGISTRY) {
    const assetRegistry =
      EVM_TOKEN_REGISTRY[authority.asset as keyof typeof EVM_TOKEN_REGISTRY];
    if (assetRegistry && 'addressesByChain' in assetRegistry) {
      const addressesByChain = assetRegistry.addressesByChain as Record<
        number,
        string | undefined
      >;
      const expectedTokenAddress =
        addressesByChain[authoritativeDestinationChainId];
      if (expectedTokenAddress) {
        if (
          params.outputToken &&
          params.outputToken.toLowerCase() !== expectedTokenAddress.toLowerCase()
        ) {
          return NextResponse.json(
            {
              success: false,
              statusCode: 400,
              error: 'OUTPUT_TOKEN_MISMATCH',
              message: `Requested quote outputToken (${params.outputToken}) does not match payment link's required asset (${authority.asset}: ${expectedTokenAddress}).`,
            },
            { status: 400 }
          );
        }
        authoritativeOutputToken = expectedTokenAddress;
      }
    }
  }

  // Reject USDT on testnet chains per Issue 10
  if (
    (isTestnetChain(params.originChainId) && isUsdtInput(params.inputToken)) ||
    (isTestnetChain(authoritativeDestinationChainId) &&
      isUsdtInput(authoritativeOutputToken))
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
    linkSigner: authority.signer,
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
        message: `SOCKET transaction builder locked by VeinPay ${scan.maxHopsQueried}-Hop Graph Firewall (${scan.verdict}).`,
        verdict: scan.verdict,
        receipt,
      },
      { status: 403 }
    );
  }

  const quoteResponse = await fetchSocketCrossChainQuote({
    originChainId: params.originChainId,
    destinationChainId: authoritativeDestinationChainId,
    inputToken: params.inputToken,
    outputToken: authoritativeOutputToken,
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

  const rawParams = {
    originChainId: sp.get('originChainId') || sp.get('fromChainId') || 42161,
    destinationChainId:
      sp.get('destinationChainId') || sp.get('toChainId') || 8453,
    inputToken:
      sp.get('inputToken') ||
      sp.get('fromTokenAddress') ||
      EVM_TOKEN_REGISTRY.USDC.addressesByChain[42161]!,
    outputToken:
      sp.get('outputToken') ||
      sp.get('toTokenAddress') ||
      EVM_TOKEN_REGISTRY.USDC.addressesByChain[8453]!,
    inputAmount: sp.get('inputAmount') || sp.get('fromAmount') || '250000000',
    userAddress:
      sp.get('userAddress') || '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
    linkId: (sp.get('linkId') || 'default').trim() || 'default',
    c: sp.get('c'),
    sig: sp.get('sig'),
    scanAttestation:
      sp.get('scanAttestation') ||
      request.headers.get('x-veinpay-scan-attestation'),
    slippage: sp.get('slippage') || '1',
    sort: sp.get('sort') || 'output',
  };

  const validation = validateWithZod(socketQuoteQuerySchema, rawParams);
  if (!validation.success) {
    return NextResponse.json(validation, { status: 400 });
  }

  const {
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
    slippage,
    sort,
  } = validation.data;

  // Policy and receiver vault are loaded strictly from the verified link (never from query string)
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
    slippage,
    sort,
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
    const rawBody = (await request.json()) as Record<string, unknown>;
    const rawParams = {
      originChainId: rawBody.originChainId ?? rawBody.fromChainId ?? 42161,
      destinationChainId:
        rawBody.destinationChainId ?? rawBody.toChainId ?? 8453,
      inputToken:
        rawBody.inputToken ??
        rawBody.fromTokenAddress ??
        EVM_TOKEN_REGISTRY.USDC.addressesByChain[42161]!,
      outputToken:
        rawBody.outputToken ??
        rawBody.toTokenAddress ??
        EVM_TOKEN_REGISTRY.USDC.addressesByChain[8453]!,
      inputAmount:
        rawBody.inputAmount ?? rawBody.fromAmount ?? '250000000',
      userAddress:
        rawBody.userAddress ?? '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
      linkId: String(rawBody.linkId ?? 'default').trim() || 'default',
      c: typeof rawBody.c === 'string' ? rawBody.c : null,
      sig: typeof rawBody.sig === 'string' ? rawBody.sig : null,
      scanAttestation:
        typeof rawBody.scanAttestation === 'string'
          ? rawBody.scanAttestation
          : request.headers.get('x-veinpay-scan-attestation'),
      slippage: String(rawBody.slippage ?? '1'),
      sort: rawBody.sort === 'time' ? 'time' : 'output',
    };

    const validation = validateWithZod(socketQuoteQuerySchema, rawParams);
    if (!validation.success) {
      return NextResponse.json(validation, { status: 400 });
    }

    const {
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
      slippage,
      sort,
    } = validation.data;

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
      slippage,
      sort,
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
