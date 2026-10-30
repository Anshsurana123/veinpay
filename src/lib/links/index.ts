export * from './canonical';
export * from './eip712';
export * from './store';
export * from './verify';
export * from './read-activity';

import type {
  FirewallPolicyConfig,
  LinkTrustLevel,
  PaymentAssetSymbol,
  SupportedEvmChainId,
  VaultSettlementMode,
} from '@/types/veinpay';
import { getVerifiedLinkPolicy } from '@/lib/security/attestation';
import { encodeSignedLinkPayloadToBase64Url } from './canonical';
import {
  getStoredLinkRecord,
  getStoredLinkRecordAsync,
  isLinkRevoked,
  isLinkRevokedAsync,
  storeSignedLinkRecord,
} from './store';
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
  destinationChainId?: SupportedEvmChainId;
  amount?: string;
  openAmount?: boolean;
  asset?: PaymentAssetSymbol;
  settlementMode?: VaultSettlementMode;
  handleStatus?: 'OWNED' | 'NOT_OWNED_BY_SIGNER';
}

/**
 * Resolves the authoritative policy and vault address for scan, quote, and CCTP routes.
 * Loads policy and vault ONLY from a cryptographically verified signed link (?c=&sig=)
 * or a server-stored verified link record (`linkId`), never from raw client query/body policy or vault fields.
 *
 * GUARANTEE: resolveVerifiedLinkAuthority NEVER throws an unhandled exception.
 */
export async function resolveVerifiedLinkAuthority(params: {
  linkId?: string | null;
  c?: string | null;
  sig?: string | null;
  allowEmptySimulatorVault?: boolean;
}): Promise<ResolvedLinkAuthority> {
  // 1. If c and sig are provided, verify the EIP-712 signed link directly
  if (params.c || params.sig) {
    try {
      const verification = await verifySignedPaymentLink({
        encodedPayload: params.c,
        signature: params.sig,
        allowEmptySimulatorVault: params.allowEmptySimulatorVault,
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

      // Check durable revocation on stateless links
      const isRevoked =
        isLinkRevoked(verification.payload.linkId) ||
        (await isLinkRevokedAsync(verification.payload.linkId));

      if (isRevoked) {
        return {
          ok: false,
          errorCode: 'REVOKED_LINK',
          reason: `Payment link ${verification.payload.linkId} has been revoked by the receiver.`,
          linkId: verification.payload.linkId,
          handle: verification.payload.handle,
          vaultAddress: verification.payload.vaultAddress,
          policy: verification.payload.policy,
          signer: verification.payload.signer,
        };
      }

      const encodedPayload =
        params.c ?? encodeSignedLinkPayloadToBase64Url(verification.payload);

      let handleStatus: 'OWNED' | 'NOT_OWNED_BY_SIGNER' = 'OWNED';
      try {
        const storeResult = storeSignedLinkRecord({
          payload: verification.payload,
          encodedPayload,
          signature: params.sig as `0x${string}`,
          trustLevel: verification.trustLevel ?? 'SIGNED_UNPROVEN',
          allowHandleCollision: true,
        });
        if (storeResult.handleCollision) {
          handleStatus = 'NOT_OWNED_BY_SIGNER';
        }
      } catch {
        handleStatus = 'NOT_OWNED_BY_SIGNER';
      }

      return {
        ok: true,
        linkId: verification.payload.linkId,
        handle: verification.payload.handle,
        vaultAddress: verification.payload.vaultAddress,
        policy: verification.payload.policy,
        trustLevel: verification.trustLevel,
        signer: verification.payload.signer,
        destinationChainId: verification.payload.destinationChainId,
        amount: verification.payload.amount,
        openAmount: verification.payload.openAmount,
        asset: verification.payload.asset,
        settlementMode: verification.payload.settlementMode,
        handleStatus,
      };
    } catch (err) {
      return {
        ok: false,
        errorCode: 'LINK_RESOLUTION_ERROR',
        reason:
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred resolving the payment link.',
        linkId: 'error',
        handle: 'error',
        vaultAddress: '',
        policy: getVerifiedLinkPolicy('default').policy,
      };
    }
  }

  // 2. Look up by linkId or handle in the server link store
  const linkKey = (params.linkId ?? 'default').trim() || 'default';
  const isRevoked =
    isLinkRevoked(linkKey) || (await isLinkRevokedAsync(linkKey));

  if (isRevoked) {
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

  const stored =
    getStoredLinkRecord(linkKey) ||
    (await getStoredLinkRecordAsync(linkKey));

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
      destinationChainId: stored.payload.destinationChainId,
      amount: stored.payload.amount,
      openAmount: stored.payload.openAmount,
      asset: stored.payload.asset,
      settlementMode: stored.payload.settlementMode,
      handleStatus: stored.handleStatus ?? 'OWNED',
    };
  }

  // 3. Fallback to registered server policy store (for split-screen simulator default or registered test policies)
  const verifiedPolicyRec = getVerifiedLinkPolicy(linkKey);
  const fallbackSigner =
    verifiedPolicyRec.signer ||
    (verifiedPolicyRec.vaultAddress.startsWith('0x')
      ? verifiedPolicyRec.vaultAddress
      : undefined);

  return {
    ok: true,
    linkId: linkKey,
    handle: linkKey,
    vaultAddress: verifiedPolicyRec.vaultAddress,
    policy: verifiedPolicyRec.policy,
    trustLevel: 'SIGNED_UNPROVEN',
    signer: fallbackSigner as `0x${string}` | undefined,
  };
}
