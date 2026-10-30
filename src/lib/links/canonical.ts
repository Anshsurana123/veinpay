import { isAddress, keccak256, toBytes } from 'viem';
import type {
  FirewallPolicyConfig,
  HopDepth,
  InconclusivePolicyMode,
  SignedPaymentLinkPayload,
  VaultSettlementMode,
} from '@/types/veinpay';

export interface CanonicalFirewallPolicy {
  cleanLinkEnabled: boolean;
  firewallEnabled: boolean;
  inconclusivePolicy: InconclusivePolicyMode;
  maxHops: HopDepth;
  socketAutoBridgeEnabled: boolean;
  sybilBlockThreshold: number;
  unbundleEnabled: boolean;
}

/**
 * Normalizes a FirewallPolicyConfig into a deterministic object with fixed fields
 * and serializes it with strictly sorted keys and zero whitespace.
 */
export function canonicalizePolicy(
  policy: FirewallPolicyConfig
): CanonicalFirewallPolicy {
  const clampedHops = Math.min(
    5,
    Math.max(1, Number(policy.maxHops) || 3)
  ) as HopDepth;
  const inconclusivePolicy: InconclusivePolicyMode =
    policy.inconclusivePolicy === 'WARN' ? 'WARN' : 'BLOCK';

  return {
    cleanLinkEnabled: Boolean(policy.cleanLinkEnabled),
    firewallEnabled: Boolean(policy.firewallEnabled),
    inconclusivePolicy,
    maxHops: clampedHops,
    socketAutoBridgeEnabled: Boolean(policy.socketAutoBridgeEnabled),
    sybilBlockThreshold: Math.max(1, Math.floor(Number(policy.sybilBlockThreshold) || 10)),
    unbundleEnabled: Boolean(policy.unbundleEnabled),
  };
}

/**
 * Produces the canonical JSON string for a FirewallPolicyConfig:
 * - Keys strictly sorted alphabetically:
 *   cleanLinkEnabled, firewallEnabled, inconclusivePolicy, maxHops,
 *   socketAutoBridgeEnabled, sybilBlockThreshold, unbundleEnabled
 * - Zero whitespace
 */
export function serializeCanonicalPolicyJson(
  policy: FirewallPolicyConfig
): string {
  const c = canonicalizePolicy(policy);
  return JSON.stringify({
    cleanLinkEnabled: c.cleanLinkEnabled,
    firewallEnabled: c.firewallEnabled,
    inconclusivePolicy: c.inconclusivePolicy,
    maxHops: c.maxHops,
    socketAutoBridgeEnabled: c.socketAutoBridgeEnabled,
    sybilBlockThreshold: c.sybilBlockThreshold,
    unbundleEnabled: c.unbundleEnabled,
  });
}

/**
 * Computes the keccak256 hash (`0x...`) of the canonicalized policy JSON.
 */
export function computePolicyKeccak256(
  policy: FirewallPolicyConfig
): `0x${string}` {
  const json = serializeCanonicalPolicyJson(policy);
  return keccak256(toBytes(json));
}

export function normalizeCanonicalAddressForMode(
  address: string,
  mode: VaultSettlementMode
): string {
  const trimmed = address.trim();
  if (mode === 'EVM_SOCKET' || isAddress(trimmed, { strict: false })) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

export function canonicalizeSignedLinkPayload(
  payload: SignedPaymentLinkPayload
): SignedPaymentLinkPayload {
  const canonicalPolicy = canonicalizePolicy(payload.policy);
  const normalizedVault = normalizeCanonicalAddressForMode(
    payload.vaultAddress,
    payload.settlementMode
  );
  const normalizedSigner = payload.signer.trim().toLowerCase() as `0x${string}`;
  const normalizedPolicyHash = payload.policyHash
    .trim()
    .toLowerCase() as `0x${string}`;

  return {
    amount: payload.openAmount ? 'OPEN' : payload.amount.trim(),
    asset: payload.asset,
    createdAt: payload.createdAt.trim(),
    destinationChainId: Number(payload.destinationChainId) as SignedPaymentLinkPayload['destinationChainId'],
    expiresAt: payload.expiresAt.trim(),
    handle: payload.handle.trim(),
    linkId: payload.linkId.trim().toLowerCase(),
    openAmount: Boolean(payload.openAmount),
    policy: canonicalPolicy,
    policyHash: normalizedPolicyHash,
    settlementMode: payload.settlementMode,
    signer: normalizedSigner,
    vaultAddress: normalizedVault,
    version: Number(payload.version),
  };
}

/**
 * Deterministically serializes any JSON value with sorted object keys and zero whitespace.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}

export function serializeCanonicalLinkPayloadJson(
  payload: SignedPaymentLinkPayload
): string {
  const canonical = canonicalizeSignedLinkPayload(payload);
  return canonicalJsonStringify(canonical);
}

export function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBase64(base64url: string): string {
  const base64 = base64url.trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return base64 + pad;
}

export function encodeSignedLinkPayloadToBase64Url(
  payload: SignedPaymentLinkPayload
): string {
  const json = serializeCanonicalLinkPayloadJson(payload);
  // Use standard base64 encoding followed by RFC 4648 character replacement so browser Buffer
  // polyfills (which lack 'base64url' encoding support) never throw 'Unknown encoding: base64url'.
  if (typeof Buffer !== 'undefined') {
    return base64ToBase64Url(Buffer.from(json, 'utf8').toString('base64'));
  }
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64ToBase64Url(btoa(binary));
}

export function decodeBase64UrlToUtf8(encoded: string): string {
  const fullBase64 = base64UrlToBase64(encoded);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(fullBase64, 'base64').toString('utf8');
  }
  const bin = atob(fullBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
