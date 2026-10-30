import { describe, expect, it, vi } from 'vitest';
import {
  queryTigerGraphRestpp,
  tryExecuteLiveTigerGraphQuery,
  buildTigerGraphFailClosedScan,
} from '@/lib/tigergraph';
import {
  CAKE_WALLET_SETTLEMENT_MODES,
  buildCakeWalletPaymentUri,
  buildCakeWalletDeepLink,
  validateCakeWalletVaultAddress,
  DEMO_CAKE_VAULT_ADDRESSES,
} from '@/lib/cakewallet';

describe('TigerGraph RESTPP Client (src/lib/tigergraph.ts)', () => {
  it('queryTigerGraphRestpp formats query URL with target_wallet, max_hops, and parses envelope', async () => {
    const origFetch = global.fetch;
    try {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: { edition: 'enterprise', api: 'v2', schema: 0 },
          error: false,
          message: '',
          results: [
            {
              verdict: 'VERIFIED_CLEAN',
              target_wallet: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
              merchant_wallet: '0x1234567890123456789012345678901234567890',
              max_hops_queried: 3,
              min_taint_hop: 999999,
              taint_hits: 0,
              sybil_cluster_size: 1,
              sybil_root_funders: [],
              cyclic_loop_detected: false,
              self_transfer_detected: false,
              dust_out_degree: 0,
              nodes_scanned: 12,
              edges_traversed: 14,
            },
          ],
        }),
      });

      const envelope = await queryTigerGraphRestpp({
        host: 'https://test-savanna.tigergraph.cloud',
        graphName: 'VeinPayGraph',
        targetWallet: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
        maxHops: 3,
        token: 'test-token',
      });

      expect(envelope.error).toBe(false);
      expect(envelope.results?.[0].verdict).toBe('VERIFIED_CLEAN');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/restpp/query/VeinPayGraph/veinpay_firewall_check?'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    } finally {
      global.fetch = origFetch;
    }
  });

  it('queryTigerGraphRestpp returns error envelope on missing host', async () => {
    const origHost = process.env.TIGERGRAPH_HOST;
    delete process.env.TIGERGRAPH_HOST;
    try {
      const envelope = await queryTigerGraphRestpp({
        targetWallet: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
      });
      expect(envelope.error).toBe(true);
      expect(envelope.message).toContain('TIGERGRAPH_HOST missing');
    } finally {
      process.env.TIGERGRAPH_HOST = origHost;
    }
  });
});

describe('Cake Wallet Default Vault Integration (src/lib/cakewallet.ts)', () => {
  it('Exposes all 3 supported Cake Wallet settlement modes', () => {
    expect(CAKE_WALLET_SETTLEMENT_MODES).toHaveLength(3);
    const modes = CAKE_WALLET_SETTLEMENT_MODES.map((m) => m.mode);
    expect(modes).toContain('EVM_SOCKET');
    expect(modes).toContain('BTC_SILENT_PAYMENT');
    expect(modes).toContain('XMR_SUBADDRESS');
  });

  it('buildCakeWalletPaymentUri generates spec-valid URIs for BIP-352 (BIP-321 & legacy) and Monero', () => {
    // Mode 2: BIP-352 Bitcoin Silent Payment
    const bip321Uri = buildCakeWalletPaymentUri({
      mode: 'BTC_SILENT_PAYMENT',
      vaultAddress: DEMO_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
      amount: '0.005',
      handle: 'ansh',
    });
    expect(bip321Uri).toContain('bitcoin:?sp=sp1qqgste7k9');
    expect(bip321Uri).toContain('amount=0.005');

    const legacyUri = buildCakeWalletPaymentUri({
      mode: 'BTC_SILENT_PAYMENT',
      vaultAddress: DEMO_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
      amount: '0.005',
      handle: 'ansh',
      legacyBtcFormat: true,
    });
    expect(legacyUri).toContain('bitcoin:sp1qqgste7k9');

    // Mode 3: Monero Subaddress
    const xmrUri = buildCakeWalletPaymentUri({
      mode: 'XMR_SUBADDRESS',
      vaultAddress: DEMO_CAKE_VAULT_ADDRESSES.XMR_SUBADDRESS,
      amount: '1.25',
      handle: 'ansh',
    });
    expect(xmrUri).toContain('monero:88');
    expect(xmrUri).toContain('tx_amount=1.25');

    // Mode 1: EVM Vault
    const evmUri = buildCakeWalletPaymentUri({
      mode: 'EVM_SOCKET',
      vaultAddress: DEMO_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
    });
    expect(evmUri).toBe(DEMO_CAKE_VAULT_ADDRESSES.EVM_SOCKET);
  });

  it('buildCakeWalletDeepLink generates cakewallet:// or native protocol deep links', () => {
    const btcDeep = buildCakeWalletDeepLink({
      mode: 'BTC_SILENT_PAYMENT',
      vaultAddress: DEMO_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
      amount: '0.01',
    });
    expect(btcDeep.deepLink).toContain('bitcoin:?sp=');

    const evmDeep = buildCakeWalletDeepLink({
      mode: 'EVM_SOCKET',
      vaultAddress: DEMO_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
      amount: '250.00',
    });
    expect(evmDeep.deepLink).toContain('cakewallet://pay?address=');
  });

  it('validateCakeWalletVaultAddress validates all 3 protocol addresses accurately', () => {
    const evmValid = validateCakeWalletVaultAddress(
      DEMO_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
      'EVM_SOCKET'
    );
    expect(evmValid.valid).toBe(true);

    const btcValid = validateCakeWalletVaultAddress(
      DEMO_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
      'BTC_SILENT_PAYMENT'
    );
    expect(btcValid.valid).toBe(true);

    const xmrValid = validateCakeWalletVaultAddress(
      DEMO_CAKE_VAULT_ADDRESSES.XMR_SUBADDRESS,
      'XMR_SUBADDRESS'
    );
    expect(xmrValid.valid).toBe(true);
  });
});
