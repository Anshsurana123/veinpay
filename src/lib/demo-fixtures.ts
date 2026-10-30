import type { VeinPayLinkConfig } from '@/types/veinpay';

/**
 * DEMO / SPEC TEST FIXTURE VAULT ADDRESSES
 *
 * WARNING: These addresses are public specification examples / test vectors
 * (EIP-55 example, BIP-352 test vector, Monero docs example) and are NOT owned
 * by VeinPay or any real receiver.
 *
 * They MUST ONLY be used in unit tests or when `NEXT_PUBLIC_DEMO_MODE === 'true'`.
 * Production defaults (`EMPTY_VAULT_ADDRESSES`) are empty strings and block link
 * creation until the receiver supplies their own valid vault address.
 */
export const DEMO_CAKE_VAULT_ADDRESSES = {
  EVM_SOCKET: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  // Official BIP-352 Test Vector Bech32m Silent Payment Address (valid 66-byte scan+spend pubkeys + Bech32m checksum)
  BTC_SILENT_PAYMENT:
    'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv',
  // Valid 95-char Monero RingCT Subaddress (Monero specification example)
  XMR_SUBADDRESS:
    '888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H',
} as const;

export const DEMO_TESTNET_CAKE_VAULT_ADDRESSES = {
  EVM_SOCKET: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  // Official BIP-352 Testnet/Signet Bech32m Silent Payment Address (tsp1... prefix + valid Bech32m checksum)
  BTC_SILENT_PAYMENT:
    'tsp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc3wk4yh',
  // Valid 95-char Monero Subaddress
  XMR_SUBADDRESS:
    '888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H',
} as const;

export const EMPTY_VAULT_ADDRESSES: VeinPayLinkConfig['vaultAddresses'] = {
  EVM_SOCKET: '',
  BTC_SILENT_PAYMENT: '',
  XMR_SUBADDRESS: '',
};

export function isDemoModeEnabled(envOverride?: string): boolean {
  const val = envOverride ?? process.env.NEXT_PUBLIC_DEMO_MODE;
  return val?.trim().toLowerCase() === 'true';
}

export function getInitialVaultAddresses(
  envOverride?: string,
  networkEnv: 'MAINNET' | 'TESTNET' = 'MAINNET'
): VeinPayLinkConfig['vaultAddresses'] {
  if (!isDemoModeEnabled(envOverride)) {
    return { ...EMPTY_VAULT_ADDRESSES };
  }
  const source =
    networkEnv === 'TESTNET'
      ? DEMO_TESTNET_CAKE_VAULT_ADDRESSES
      : DEMO_CAKE_VAULT_ADDRESSES;
  return {
    EVM_SOCKET: source.EVM_SOCKET,
    BTC_SILENT_PAYMENT: source.BTC_SILENT_PAYMENT,
    XMR_SUBADDRESS: source.XMR_SUBADDRESS,
  };
}
