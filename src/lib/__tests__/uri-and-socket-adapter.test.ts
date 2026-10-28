import { describe, expect, it } from 'vitest';
import {
  buildBip321SilentPaymentUri,
  buildLegacySilentPaymentUri,
  buildMoneroPaymentUri,
  DEFAULT_CAKE_VAULT_ADDRESSES,
  TESTNET_CAKE_VAULT_ADDRESSES,
  validateBip352SilentPaymentAddress,
  validateMoneroAddress,
} from '@/lib/validators/address';
import {
  buildDeterministicFallbackQuote,
  buildSameChainDirectRoute,
} from '@/lib/socket/client';
import {
  isTestnetChain,
  resolveTokenByAddressOrSymbol,
} from '@/lib/socket/tokens';

describe('Cake Wallet BIP-352/BIP-321 & Monero URIs + SOCKET V3/V2 Adapter', () => {
  it('Validates official BIP-352 Silent Payment test vector and builds BIP-321 & legacy URIs', () => {
    const spValidation = validateBip352SilentPaymentAddress(
      DEFAULT_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT
    );
    expect(spValidation.valid).toBe(true);
    expect(spValidation.network).toBe('mainnet');

    const bip321 = buildBip321SilentPaymentUri({
      spAddress: DEFAULT_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
      amountBtc: '0.0025',
      label: 'VeilPay Vault',
    });
    expect(bip321).toContain('bitcoin:?sp=sp1qqgste7k9');
    expect(bip321).toContain('amount=0.0025');
    expect(bip321).toContain('label=VeilPay%20Vault');

    const legacy = buildLegacySilentPaymentUri({
      spAddress: DEFAULT_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
      amountBtc: '0.0025',
      label: 'VeilPay Vault',
    });
    expect(legacy).toContain('bitcoin:sp1qqgste7k9');
  });

  it('Validates Monero RingCT subaddress and builds spec-compliant monero: URI', () => {
    const xmrCheck = validateMoneroAddress(
      DEFAULT_CAKE_VAULT_ADDRESSES.XMR_SUBADDRESS
    );
    expect(xmrCheck.valid).toBe(true);
    expect(xmrCheck.addressType).toBe('SUBADDRESS');

    const uri = buildMoneroPaymentUri({
      subaddress: DEFAULT_CAKE_VAULT_ADDRESSES.XMR_SUBADDRESS,
      amountXmr: '1.5',
      recipientName: 'VeilPay Audit',
    });
    expect(uri).toContain(
      `monero:${DEFAULT_CAKE_VAULT_ADDRESSES.XMR_SUBADDRESS}?tx_amount=1.5&recipient_name=VeilPay%20Audit`
    );
  });

  it('Builds Same-Chain Direct and Deterministic Fallback quotes exposing both V2 and V3 fields', () => {
    const sameChain = buildSameChainDirectRoute(
      {
        originChainId: 8453,
        destinationChainId: 8453,
        inputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        inputAmount: '250000000',
        userAddress: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
        receiverAddress: DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
      },
      0.5
    );
    expect(sameChain.source).toBe('SAME_CHAIN_DIRECT');
    expect(sameChain.result.routes[0].toAmount).toBe('250000000');
    expect(sameChain.result.routes[0].usedBridgeNames[0]).toContain('Direct');

    const fallback = buildDeterministicFallbackQuote(
      {
        originChainId: 42161,
        destinationChainId: 8453,
        inputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        inputAmount: '250000000',
        userAddress: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
        receiverAddress: DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
      },
      'Test timeout',
      3500
    );
    expect(fallback.source).toBe('FALLBACK_DETERMINISTIC');
    expect(fallback.result.routes[0].usedBridgeNames).toContain(
      'Socket Intents (Bungee RFQ)'
    );
    expect(fallback.result.routes[0].serviceTime).toBe(3);
    expect(fallback.result.routes[0].totalGasFeesInUsd).toBe(0.003);
  });

  it('Validates BIP-352 Testnet (tsp1...) Silent Payment address and EVM Testnet chain/token registry', () => {
    const tspValidation = validateBip352SilentPaymentAddress(
      TESTNET_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT
    );
    expect(tspValidation.valid).toBe(true);
    expect(tspValidation.network).toBe('testnet');

    expect(isTestnetChain(84532)).toBe(true); // Base Sepolia
    expect(isTestnetChain(421614)).toBe(true); // Arbitrum Sepolia
    expect(isTestnetChain(11155111)).toBe(true); // Ethereum Sepolia
    expect(isTestnetChain(11155420)).toBe(true); // OP Sepolia
    expect(isTestnetChain(80002)).toBe(true); // Polygon Amoy
    expect(isTestnetChain(8453)).toBe(false); // Base Mainnet

    const baseSepoliaUsdc = resolveTokenByAddressOrSymbol(84532, 'USDC');
    expect(baseSepoliaUsdc.address).toBe(
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    );
  });
});
