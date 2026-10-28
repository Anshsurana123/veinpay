import { NextRequest, NextResponse } from 'next/server';
import type { HopDepth } from '@/types/veilpay';
import { DEFAULT_CAKE_VAULT_ADDRESSES } from '@/lib/validators/address';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';
import { generateAigiForensicReceipt } from '@/lib/aigi/verdict';
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
  slippage?: string;
  sort?: 'output' | 'time';
  firewallEnabled: boolean;
  maxHops: HopDepth;
  cleanLinkEnabled: boolean;
  unbundleEnabled: boolean;
  sybilBlockThreshold: number;
}) {
  // CRITICAL SECURITY GATE: Run TigerGraph pre-flight firewall check BEFORE building SOCKET quote!
  const scan = runVeilPayFirewallTraversal({
    targetWallet: params.userAddress,
    merchantWallet: params.receiverAddress,
    policy: {
      firewallEnabled: params.firewallEnabled,
      maxHops: params.maxHops,
      cleanLinkEnabled: params.cleanLinkEnabled,
      unbundleEnabled: params.unbundleEnabled,
      socketAutoBridgeEnabled: true,
      sybilBlockThreshold: params.sybilBlockThreshold,
    },
  });

  if (!scan.socketUnlocked) {
    const receipt = generateAigiForensicReceipt(scan);
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
    receiverAddress: params.receiverAddress,
    slippage: params.slippage,
    sort: params.sort,
  });

  return NextResponse.json(quoteResponse, { status: 200 });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  // Support both Socket V3 and legacy V2 parameter names seamlessly
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

  const maxHops = Math.min(
    5,
    Math.max(1, Number(sp.get('maxHops') || sp.get('max_hops') || 3))
  ) as HopDepth;

  const firewallEnabled =
    sp.get('firewallEnabled') !== null
      ? sp.get('firewallEnabled') !== 'false'
      : true;

  return executeGatedQuoteRequest({
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    inputAmount,
    userAddress,
    receiverAddress,
    slippage: sp.get('slippage') || '1',
    sort: sp.get('sort') === 'time' ? 'time' : 'output',
    firewallEnabled,
    maxHops,
    cleanLinkEnabled: sp.get('cleanLinkEnabled') !== 'false',
    unbundleEnabled: sp.get('unbundleEnabled') !== 'false',
    sybilBlockThreshold: Number(sp.get('sybilBlockThreshold') || 10),
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
    const maxHops = Math.min(
      5,
      Math.max(1, Number(body.maxHops ?? 3))
    ) as HopDepth;

    return executeGatedQuoteRequest({
      originChainId,
      destinationChainId,
      inputToken,
      outputToken,
      inputAmount,
      userAddress,
      receiverAddress,
      slippage: String(body.slippage ?? '1'),
      sort: body.sort === 'time' ? 'time' : 'output',
      firewallEnabled:
        body.firewallEnabled !== undefined ? Boolean(body.firewallEnabled) : true,
      maxHops,
      cleanLinkEnabled:
        body.cleanLinkEnabled !== undefined ? Boolean(body.cleanLinkEnabled) : true,
      unbundleEnabled:
        body.unbundleEnabled !== undefined ? Boolean(body.unbundleEnabled) : true,
      sybilBlockThreshold: Number(body.sybilBlockThreshold ?? 10),
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
