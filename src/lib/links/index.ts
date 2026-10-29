export * from './canonical';
export * from './eip712';
export * from './store';
export * from './verify';

import type { FirewallPolicyConfig, LinkTrustLevel } from '@/types/veilpay';
import { getVerifiedLinkPolicy } from '@/lib/security/attestation';
import { DEFAULT_CAKE_VAULT_ADDRESSES } from '@/lib/validators/address';
import { encodeSignedLinkPayloadToBase64Url } from './canonical';
import { getStoredLinkRecord, isLinkRevoked, storeSignedLinkRecord } from './store';
import { verifySignedPaymentLink } from './verify';

export interface ResolvedLinkAuthority {
  ok: boolean;
  errorCode?: string;
  reason?: string;
  linkId: string;
  handle: string;
  vaultAddress: string;
  policy: FirewallPolicyConfig;
  trustLevel?: LinkTrustLevel;
  signer?: `0x${string}`;
}

/**
 * Resolves the authoritative policy and vault address for scan, quote, and CCTP routes.
 * Loads policy and vault ONLY from a cryptographically verified signed link (?c=&sig=)
 * or a server-stored verified link record (`linkId`), never from raw client query/body policy or vault fields.
 */
export async function resolveVerifiedLinkAuthority(params: {
  linkId?: string | null;
  c?: string | null;
  sig?: string | null;
}): Promise<ResolvedLinkAuthority> {
  // 1. If c and sig are provided, verify the EIP-712 signed link directly
  if (params.c || params.sig) {
    const verification = await verifySignedPaymentLink({
      encodedPayload: params.c,
      signature: params.sig,
    });
    if (!verification.valid || !verification.payload) {
      return {
        ok: false,
        errorCode: verification.errorCode ?? 'INVALID_SIGNED_LINK',
        reason:
          verification.reason ??
          'Payment link signature or payload failed EIP-712 verification.',
        linkId: 'invalid',
        handle: 'invalid',
        vaultAddress: '',
        policy: getVerifiedLinkPolicy('default').policy,
      };
    }

    const encodedPayload =
      params.c ?? encodeSignedLinkPayloadToBase64Url(verification.payload);
    storeSignedLinkRecord({
      payload: verification.payload,
      encodedPayload,
      signature: params.sig as `0x${string}`,
      trustLevel: verification.trustLevel ?? 'SIGNED_UNPROVEN',
    });

    return {
      ok: true,
      linkId: verification.payload.linkId,
      handle: verification.payload.handle,
      vaultAddress: verification.payload.vaultAddress,
      policy: verification.payload.policy,
      trustLevel: verification.trustLevel,
      signer: verification.payload.signer,
    };
  }

  // 2. Look up by linkId in the server link store
  const linkKey = (params.linkId ?? 'default').trim() || 'default';
  if (isLinkRevoked(linkKey)) {
    return {
      ok: false,
      errorCode: 'REVOKED_LINK',
      reason: `Payment link ${linkKey} has been revoked by the receiver.`,
      linkId: linkKey,
      handle: linkKey,
      vaultAddress: '',
      policy: getVerifiedLinkPolicy('default').policy,
    };
  }

  const stored = getStoredLinkRecord(linkKey);
  if (stored) {
    const now = Date.now();
    if (Date.parse(stored.payload.expiresAt) <= now) {
      return {
        ok: false,
        errorCode: 'EXPIRED_LINK',
        reason: `Payment link ${linkKey} expired at ${stored.payload.expiresAt}.`,
        linkId: stored.linkId,
        handle: stored.handle,
        vaultAddress: '',
        policy: stored.payload.policy,
      };
    }
    return {
      ok: true,
      linkId: stored.linkId,
      handle: stored.handle,
      vaultAddress: stored.payload.vaultAddress,
      policy: stored.payload.policy,
      trustLevel: stored.trustLevel,
      signer: stored.payload.signer,
    };
  }

  // 3. Fallback to registered server policy store (for split-screen simulator default or registered test policies)
  const verifiedPolicyRec = getVerifiedLinkPolicy(linkKey);
  return {
    ok: true,
    linkId: verifiedPolicyRec.linkId,
    handle: verifiedPolicyRec.linkId,
    vaultAddress:
      verifiedPolicyRec.vaultAddress ||
      DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
    policy: verifiedPolicyRec.policy,
  };
}
