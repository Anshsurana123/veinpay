import type { VeilPayLinkConfig } from '@/types/veilpay';
import { DEFAULT_CAKE_VAULT_ADDRESSES } from '@/lib/validators/address';

export const DEFAULT_LINK_CONFIG: VeilPayLinkConfig = {
  handle: 'ansh-audit',
  amount: '250.00',
  asset: 'USDC',
  destinationChainId: 8453, // Base Mainnet default
  settlementMode: 'EVM_SOCKET',
  vaultAddresses: {
    EVM_SOCKET: DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
    BTC_SILENT_PAYMENT: DEFAULT_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
    XMR_SUBADDRESS: DEFAULT_CAKE_VAULT_ADDRESSES.XMR_SUBADDRESS,
  },
  policy: {
    firewallEnabled: true,
    maxHops: 3,
    cleanLinkEnabled: true,
    unbundleEnabled: true,
    socketAutoBridgeEnabled: true,
    sybilBlockThreshold: 10,
  },
  createdAt: '2026-10-28T12:00:00.000Z',
};

export function encodeLinkConfigToBase64Url(config: VeilPayLinkConfig): string {
  const json = JSON.stringify(config);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  const base64 = btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  ));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeLinkConfigFromBase64Url(
  encoded: string | null | undefined,
  fallbackHandle?: string
): VeilPayLinkConfig {
  if (!encoded) {
    return {
      ...DEFAULT_LINK_CONFIG,
      handle: fallbackHandle || DEFAULT_LINK_CONFIG.handle,
    };
  }
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    let json = '';
    if (typeof Buffer !== 'undefined') {
      json = Buffer.from(base64 + pad, 'base64').toString('utf8');
    } else {
      const bin = atob(base64 + pad);
      json = decodeURIComponent(
        Array.from(bin)
          .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join('')
      );
    }
    const parsed = JSON.parse(json) as Partial<VeilPayLinkConfig>;
    return {
      ...DEFAULT_LINK_CONFIG,
      ...parsed,
      handle: fallbackHandle || parsed.handle || DEFAULT_LINK_CONFIG.handle,
      vaultAddresses: {
        ...DEFAULT_LINK_CONFIG.vaultAddresses,
        ...(parsed.vaultAddresses ?? {}),
      },
      policy: {
        ...DEFAULT_LINK_CONFIG.policy,
        ...(parsed.policy ?? {}),
      },
    };
  } catch {
    return {
      ...DEFAULT_LINK_CONFIG,
      handle: fallbackHandle || DEFAULT_LINK_CONFIG.handle,
    };
  }
}
