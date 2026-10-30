import { describe, expect, it } from 'vitest';
import {
  EVM_TOKEN_REGISTRY,
  isTestnetChain,
  isTokenSupportedOnChain,
  resolveTokenByAddressOrSymbol,
  SUPPORTED_EVM_CHAINS,
} from '@/lib/socket/tokens';
import { fetchSocketCrossChainQuote } from '@/lib/socket/client';
import { verifySignedPaymentLink } from '@/lib/links/verify';
import { buildPaymentLinkTypedData } from '@/lib/links/eip712';
import { encodeSignedLinkPayloadToBase64Url, computePolicyKeccak256 } from '@/lib/links/canonical';
import { privateKeyToAccount } from 'viem/accounts';
import type { SignedPaymentLinkPayload } from '@/types/veinpay';

const TEST_RECEIVER = privateKeyToAccount(
  '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'
);

describe('Issue 10: Testnet USDT Removal and Rejection', () => {
  const testnetChainIds = [11155111, 84532, 421614, 11155420, 80002];
  const mainnetChainIds = [1, 42161, 8453, 10, 137];

  it('Ensures EVM_TOKEN_REGISTRY.USDT contains no testnet chain IDs', () => {
    const usdtChains = Object.keys(EVM_TOKEN_REGISTRY.USDT.addressesByChain).map(
      Number
    );

    for (const testnetId of testnetChainIds) {
      expect(usdtChains).not.toContain(testnetId);
      expect(
        EVM_TOKEN_REGISTRY.USDT.addressesByChain[
          testnetId as keyof typeof EVM_TOKEN_REGISTRY.USDT.addressesByChain
        ]
      ).toBeUndefined();
    }

    for (const mainnetId of mainnetChainIds) {
      expect(usdtChains).toContain(mainnetId);
      expect(
        EVM_TOKEN_REGISTRY.USDT.addressesByChain[
          mainnetId as keyof typeof EVM_TOKEN_REGISTRY.USDT.addressesByChain
        ]
      ).toBeDefined();
    }
  });

  it('Verifies isTokenSupportedOnChain rejects USDT on all testnets but permits on mainnets', () => {
    for (const testnetId of testnetChainIds) {
      expect(isTokenSupportedOnChain('USDT', testnetId)).toBe(false);
      expect(isTokenSupportedOnChain('USDC', testnetId)).toBe(true);
      expect(isTokenSupportedOnChain('ETH', testnetId)).toBe(true);
    }

    for (const mainnetId of mainnetChainIds) {
      expect(isTokenSupportedOnChain('USDT', mainnetId)).toBe(true);
      expect(isTokenSupportedOnChain('USDC', mainnetId)).toBe(true);
      expect(isTokenSupportedOnChain('ETH', mainnetId)).toBe(true);
    }
  });

  it('Throws clear error in resolveTokenByAddressOrSymbol when USDT is requested on testnet', () => {
    for (const testnetId of testnetChainIds) {
      expect(() => resolveTokenByAddressOrSymbol(testnetId, 'USDT')).toThrow(
        /USDT is not supported on testnet/i
      );
    }
  });

  it('Resolves testnet USDC addresses strictly as USDC without USDT ambiguity', () => {
    for (const testnetId of testnetChainIds) {
      const usdcAddress = EVM_TOKEN_REGISTRY.USDC.addressesByChain[
        testnetId as keyof typeof EVM_TOKEN_REGISTRY.USDC.addressesByChain
      ]!;
      const resolved = resolveTokenByAddressOrSymbol(testnetId, usdcAddress);
      expect(resolved.symbol).toBe('USDC');
      expect(resolved.address.toLowerCase()).toBe(usdcAddress.toLowerCase());
    }
  });

  it('fetchSocketCrossChainQuote returns UNSUPPORTED_ON_TESTNET when USDT is selected', async () => {
    const res = await fetchSocketCrossChainQuote({
      originChainId: 84532,
      destinationChainId: 84532,
      inputToken: 'USDT',
      outputToken: 'USDC',
      inputAmount: '1000000',
      userAddress: '0x1111111111111111111111111111111111111111',
      receiverAddress: '0x2222222222222222222222222222222222222222',
    });

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.source).toBe('UNSUPPORTED_ON_TESTNET');
    expect(res.fallbackReason).toMatch(/USDT is not supported on testnet/i);
  });

  it('verifySignedPaymentLink rejects links with destinationChainId on testnet and asset USDT', async () => {
    const policy = {
      firewallEnabled: true,
      maxHops: 3 as const,
      cleanLinkEnabled: true,
      unbundleEnabled: true,
      poisonGraphEnabled: true,
      sybilBlockThreshold: 10,
      inconclusivePolicy: 'BLOCK' as const,
      socketAutoBridgeEnabled: true,
    };
    const policyHash = computePolicyKeccak256(policy);

    const payload: SignedPaymentLinkPayload = {
      version: 1,
      linkId: 'test-usdt-link',
      handle: 'test-merchant',
      amount: '50.00',
      openAmount: false,
      asset: 'USDT',
      destinationChainId: 84532, // Base Sepolia
      settlementMode: 'EVM_SOCKET',
      vaultAddress: TEST_RECEIVER.address,
      policyHash,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      signer: TEST_RECEIVER.address,
      policy,
    };

    const sig = await TEST_RECEIVER.signTypedData(buildPaymentLinkTypedData(payload));
    const c = encodeSignedLinkPayloadToBase64Url(payload);

    const result = await verifySignedPaymentLink({
      encodedPayload: c,
      signature: sig,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('MALFORMED_LINK_PAYLOAD');
    expect(result.reason).toMatch(/USDT is not supported on testnet/i);
  });
});
