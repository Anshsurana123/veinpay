import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type {
  FirewallPolicyConfig,
  PaymentAssetSymbol,
  SignedPaymentLinkPayload,
  SupportedEvmChainId,
  VaultSettlementMode,
  VeilPayLinkConfig,
} from '@/types/veilpay';
import {
  canonicalizePolicy,
  computePolicyKeccak256,
  encodeSignedLinkPayloadToBase64Url,
  normalizeCanonicalAddressForMode,
} from '@/lib/links/canonical';

/**
 * VeilPay EIP-712 Domain
 * Intentionally omits `chainId` and `verifyingContract` so the receiver can sign
 * a cross-chain payment link without forcing a wallet chain-switch prompt.
 * `destinationChainId` is included inside the signed `PaymentLink` message itself.
 */
export const VEILPAY_EIP712_DOMAIN = {
  name: 'VeilPay',
  version: '1',
} as const;

export const PAYMENT_LINK_EIP712_TYPES = {
  PaymentLink: [
    { name: 'version', type: 'uint8' },
    { name: 'linkId', type: 'string' },
    { name: 'handle', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'openAmount', type: 'bool' },
    { name: 'asset', type: 'string' },
    { name: 'destinationChainId', type: 'uint256' },
    { name: 'settlementMode', type: 'string' },
    { name: 'vaultAddress', type: 'string' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'createdAt', type: 'string' },
    { name: 'expiresAt', type: 'string' },
    { name: 'signer', type: 'address' },
  ],
} as const;

export const REVOKE_LINK_EIP712_TYPES = {
  Revoke: [
    { name: 'linkId', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'issuedAt', type: 'string' },
  ],
} as const;

export const DEFAULT_LINK_EXPIRY_DAYS = 30;

export function generateRandomLinkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return (
      '0x' +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );
  }
  let hex = '0x';
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

export function createPaymentLinkPayload(params: {
  linkId?: string;
  handle: string;
  amount: string;
  openAmount?: boolean;
  asset: PaymentAssetSymbol;
  destinationChainId: SupportedEvmChainId;
  settlementMode: VaultSettlementMode;
  vaultAddress: string;
  policy: FirewallPolicyConfig;
  signer: string;
  createdAt?: string;
  expiresAt?: string;
  ttlDays?: number;
  nowMs?: number;
}): SignedPaymentLinkPayload {
  const now = params.nowMs ?? Date.now();
  const ttlDays = params.ttlDays ?? DEFAULT_LINK_EXPIRY_DAYS;
  const createdAt = params.createdAt ?? new Date(now).toISOString();
  const expiresAt =
    params.expiresAt ??
    new Date(now + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const canonicalPolicy = canonicalizePolicy(params.policy);
  const policyHash = computePolicyKeccak256(canonicalPolicy);
  const openAmount = Boolean(params.openAmount);
  const normalizedVault = normalizeCanonicalAddressForMode(
    params.vaultAddress,
    params.settlementMode
  );

  return {
    version: 1,
    linkId: (params.linkId ?? generateRandomLinkId()).trim().toLowerCase(),
    handle: params.handle.trim() || 'goa.eth',
    amount: openAmount ? 'OPEN' : params.amount.trim(),
    openAmount,
    asset: params.asset,
    destinationChainId: params.destinationChainId,
    settlementMode: params.settlementMode,
    vaultAddress: normalizedVault,
    policyHash,
    policy: canonicalPolicy,
    createdAt,
    expiresAt,
    signer: params.signer.trim().toLowerCase() as `0x${string}`,
  };
}

export function buildPaymentLinkTypedData(payload: SignedPaymentLinkPayload) {
  const checksumSigner = getAddress(payload.signer);
  const normalizedVault = normalizeCanonicalAddressForMode(
    payload.vaultAddress,
    payload.settlementMode
  );

  return {
    domain: VEILPAY_EIP712_DOMAIN,
    types: PAYMENT_LINK_EIP712_TYPES,
    primaryType: 'PaymentLink' as const,
    message: {
      version: Number(payload.version),
      linkId: payload.linkId.trim().toLowerCase(),
      handle: payload.handle.trim(),
      amount: payload.openAmount ? 'OPEN' : payload.amount.trim(),
      openAmount: Boolean(payload.openAmount),
      asset: payload.asset,
      destinationChainId: BigInt(payload.destinationChainId),
      settlementMode: payload.settlementMode,
      vaultAddress: normalizedVault,
      policyHash: payload.policyHash.toLowerCase() as `0x${string}`,
      createdAt: payload.createdAt.trim(),
      expiresAt: payload.expiresAt.trim(),
      signer: checksumSigner,
    },
  };
}

export interface RevokeLinkMessage {
  linkId: string;
  signer: `0x${string}`;
  issuedAt: string;
}

export function buildRevokeLinkTypedData(params: RevokeLinkMessage) {
  const checksumSigner = getAddress(params.signer);
  return {
    domain: VEILPAY_EIP712_DOMAIN,
    types: REVOKE_LINK_EIP712_TYPES,
    primaryType: 'Revoke' as const,
    message: {
      linkId: params.linkId.trim().toLowerCase(),
      signer: checksumSigner,
      issuedAt: params.issuedAt.trim(),
    },
  };
}

let ephemeralSimulatorKey: `0x${string}` | null = null;
function getEphemeralSimulatorKey(): `0x${string}` {
  if (!ephemeralSimulatorKey) {
    ephemeralSimulatorKey = generatePrivateKey();
  }
  return ephemeralSimulatorKey;
}

/**
 * Builds an EIP-712 signed preview link for the split-screen local simulator so that
 * `/api/firewall/scan` and `/api/socket/quote` always verify a real EIP-712 signature
 * without reading raw policy or vault fields from the request body.
 */
export async function buildSimulatorSignedPreviewLink(
  config: VeilPayLinkConfig
): Promise<{
  payload: SignedPaymentLinkPayload;
  c: string;
  sig: `0x${string}`;
}> {
  const simAccount = privateKeyToAccount(getEphemeralSimulatorKey());
  const vaultAddr = config.vaultAddresses[config.settlementMode] ?? '';
  const payload = createPaymentLinkPayload({
    linkId: `0xsim_${(config.handle || 'default').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'default'}`,
    handle: config.handle || 'goa.eth',
    amount: config.amount || '250.00',
    openAmount: false,
    asset: config.asset,
    destinationChainId: config.destinationChainId,
    settlementMode: config.settlementMode,
    vaultAddress: vaultAddr,
    policy: config.policy,
    signer: simAccount.address,
  });
  const typedData = buildPaymentLinkTypedData(payload);
  const sig = await simAccount.signTypedData(typedData);
  const c = encodeSignedLinkPayloadToBase64Url(payload);
  return { payload, c, sig };
}

