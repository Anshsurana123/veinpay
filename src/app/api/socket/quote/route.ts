import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_CAKE_VAULT_ADDRESSES } from '@/lib/validators/address';
import { runFullScan } from '@/lib/graph/full-scan';
import {
  getVerifiedLinkPolicy,
  verifyScanAttestation,
} from '@/lib/security/attestation';
import { fetchSocketCrossChainQuote } from '@/lib/socket/client';
import { EVM_TOKEN_REGISTRY } from '@/lib/socket/tokens';

async function executeGatedQuoteRequest(params: {
  originChainId: number;
  destinationChainId: number;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  userAddress: string;
  receiverAddress: string;
  linkId: string;
  scanAttestation: string | null;
  slippage?: string;
  sort?: 'output' | 'time';
}) {
  // 1. Load authoritative policy from verified link ONLY (ignore any client-supplied policy params)
  const verifiedLink = getVerifiedLinkPolicy(params.linkId);
  const authoritativePolicy = verifiedLink.policy;
  const authoritativeReceiver =
    verifiedLink.vaultAddress || params.receiverAddress;

  // 2. Verify short-lived server scanAttestation & require proofOfControl === true
  const attestationCheck = verifyScanAttestation(params.scanAttestation, {
    payer: params.userAddress,
    linkId: verifiedLink.linkId,
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
  // using the authoritative link policy so client policy params can never bypass the gate
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
    EVM_TOKEN_REGISTRY.USDC.addressesByChain[42161];
  const outputToken =
    sp.get('outputToken') ||
    sp.get('toTokenAddress') ||
    EVM_TOKEN_REGISTRY.USDC.addressesByChain[8453];
  const inputAmount =
    sp.get('inputAmount') || sp.get('fromAmount') || '250000000';
  const userAddress =
    sp.get('userAddress') || '0x4F2a9c117034e8B1200499A1c3f88200000188E1';
  const receiverAddress =
    sp.get('receiverAddress') ||
    sp.get('recipient') ||
    DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET;
  const linkId = (sp.get('linkId') || 'default').trim() || 'default';
  const scanAttestation =
    sp.get('scanAttestation') ||
    request.headers.get('x-veilpay-scan-attestation');

  // Note: Any client-supplied firewallEnabled / maxHops / cleanLinkEnabled / unbundleEnabled /
  // sybilBlockThreshold query parameters are intentionally ignored.
  return executeGatedQuoteRequest({
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    inputAmount,
    userAddress,
    receiverAddress,
    linkId,
    scanAttestation,
    slippage: sp.get('slippage') || '1',
    sort: sp.get('sort') === 'time' ? 'time' : 'output',
  });
}

export async function POST(request: NextRequest) {
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
    const receiverAddress = String(
      body.receiverAddress ??
        body.recipient ??
        DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET
    );
    const linkId = String(body.linkId ?? 'default').trim() || 'default';
    const scanAttestation =
      typeof body.scanAttestation === 'string'
        ? body.scanAttestation
        : request.headers.get('x-veilpay-scan-attestation');

    return executeGatedQuoteRequest({
      originChainId,
      destinationChainId,
      inputToken,
      outputToken,
      inputAmount,
      userAddress,
      receiverAddress,
      linkId,
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
