import type {
  SignedPaymentLinkPayload,
  VeilPayLinkConfig,
} from '@/types/veilpay';
import { getInitialVaultAddresses } from '@/lib/demo-fixtures';
import {
  decodeBase64UrlToUtf8,
  encodeSignedLinkPayloadToBase64Url,
} from '@/lib/links/canonical';

export const DEFAULT_LINK_CONFIG: VeilPayLinkConfig = {
  handle: 'ansh-audit',
  amount: '250.00',
  asset: 'USDC',
  destinationChainId: 8453, // Base Mainnet default
  settlementMode: 'EVM_SOCKET',
  vaultAddresses: getInitialVaultAddresses(),
  policy: {
    firewallEnabled: true,
    maxHops: 3,
    cleanLinkEnabled: true,
    unbundleEnabled: true,
    socketAutoBridgeEnabled: true,
    sybilBlockThreshold: 10,
    inconclusivePolicy: 'BLOCK',
  },
  createdAt: '2026-10-28T12:00:00.000Z',
};

export function signedLinkPayloadToVeilPayConfig(
  payload: SignedPaymentLinkPayload
): VeilPayLinkConfig {
  return {
    handle: payload.handle,
    amount: payload.openAmount ? '250.00' : payload.amount,
    asset: payload.asset,
    destinationChainId: payload.destinationChainId,
    settlementMode: payload.settlementMode,
    vaultAddresses: {
      EVM_SOCKET:
        payload.settlementMode === 'EVM_SOCKET' ? payload.vaultAddress : '',
      BTC_SILENT_PAYMENT:
        payload.settlementMode === 'BTC_SILENT_PAYMENT'
          ? payload.vaultAddress
          : '',
      XMR_SUBADDRESS:
        payload.settlementMode === 'XMR_SUBADDRESS' ? payload.vaultAddress : '',
    },
    policy: {
      ...payload.policy,
    },
    createdAt: payload.createdAt,
  };
}

export { encodeSignedLinkPayloadToBase64Url };

export function decodeSignedPayloadFromBase64Url(
  encoded: string | null | undefined
): SignedPaymentLinkPayload | null {
  if (!encoded) return null;
  try {
    const json = decodeBase64UrlToUtf8(encoded);
    const parsed = JSON.parse(json) as Partial<SignedPaymentLinkPayload>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== 1 ||
      !parsed.linkId ||
      !parsed.policyHash ||
      !parsed.signer
    ) {
      return null;
    }
    return parsed as SignedPaymentLinkPayload;
  } catch {
    return null;
  }
}
