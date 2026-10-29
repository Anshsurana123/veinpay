import { describe, expect, it } from 'vitest';
import {
  DEMO_CAKE_VAULT_ADDRESSES,
  DEMO_TESTNET_CAKE_VAULT_ADDRESSES,
  EMPTY_VAULT_ADDRESSES,
  getInitialVaultAddresses,
  isDemoModeEnabled,
} from '@/lib/demo-fixtures';
import { DEFAULT_LINK_CONFIG } from '@/lib/utils/link-codec';
import { verifySignedPaymentLink } from '@/lib/links/verify';
import { createPaymentLinkPayload } from '@/lib/links/eip712';
import { encodeSignedLinkPayloadToBase64Url } from '@/lib/links/canonical';

describe('Issue 6: Default vault addresses are empty in production & require receiver entry', () => {
  it('Production default vault addresses are strictly empty strings', () => {
    const prodVaults = getInitialVaultAddresses('false');
    expect(prodVaults.EVM_SOCKET).toBe('');
    expect(prodVaults.BTC_SILENT_PAYMENT).toBe('');
    expect(prodVaults.XMR_SUBADDRESS).toBe('');

    expect(EMPTY_VAULT_ADDRESSES.EVM_SOCKET).toBe('');
    expect(EMPTY_VAULT_ADDRESSES.BTC_SILENT_PAYMENT).toBe('');
    expect(EMPTY_VAULT_ADDRESSES.XMR_SUBADDRESS).toBe('');
  });

  it('Default link config vault addresses are empty when demo mode is disabled', () => {
    // In test environment without NEXT_PUBLIC_DEMO_MODE='true'
    expect(DEFAULT_LINK_CONFIG.vaultAddresses.EVM_SOCKET).toBe('');
    expect(DEFAULT_LINK_CONFIG.vaultAddresses.BTC_SILENT_PAYMENT).toBe('');
    expect(DEFAULT_LINK_CONFIG.vaultAddresses.XMR_SUBADDRESS).toBe('');
  });

  it('Demo fixtures are isolated to demo-fixtures.ts and labeled as demo', () => {
    expect(DEMO_CAKE_VAULT_ADDRESSES.EVM_SOCKET).toBe(
      '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
    );
    expect(DEMO_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT.startsWith('sp1')).toBe(
      true
    );
    expect(DEMO_CAKE_VAULT_ADDRESSES.XMR_SUBADDRESS.startsWith('8')).toBe(true);

    expect(DEMO_TESTNET_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT.startsWith('tsp1')).toBe(
      true
    );

    // If demo mode is enabled explicitly
    expect(isDemoModeEnabled('true')).toBe(true);

    const demoVaults = getInitialVaultAddresses('true');
    expect(demoVaults.EVM_SOCKET).toBe(DEMO_CAKE_VAULT_ADDRESSES.EVM_SOCKET);
  });

  it('Rejects payment link creation and verification when vaultAddress is empty', async () => {
    const emptyVaultPayload = createPaymentLinkPayload({
      handle: 'empty-vault-test',
      amount: '100.00',
      asset: 'USDC',
      destinationChainId: 8453,
      settlementMode: 'EVM_SOCKET',
      vaultAddress: '',
      signer: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
      policy: {
        firewallEnabled: true,
        maxHops: 3,
        cleanLinkEnabled: true,
        unbundleEnabled: true,
        sybilBlockThreshold: 10,
        socketAutoBridgeEnabled: true,
        inconclusivePolicy: 'BLOCK',
      },
    });

    const encoded = encodeSignedLinkPayloadToBase64Url(emptyVaultPayload);
    const result = await verifySignedPaymentLink({
      encodedPayload: encoded,
      signature: '0x1234',
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Destination vault address is empty');
  });
});
