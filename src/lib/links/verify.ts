import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  verifyTypedData,
  type PublicClient,
} from 'viem';
import { mainnet } from 'viem/chains';
import type {
  LinkTrustLevel,
  SignedPaymentLinkPayload,
} from '@/types/veinpay';
import {
  canonicalizeSignedLinkPayload,
  computePolicyKeccak256,
  decodeBase64UrlToUtf8,
} from '@/lib/links/canonical';
import {
  buildPaymentLinkTypedData,
  buildRevokeLinkTypedData,
  type RevokeLinkMessage,
} from '@/lib/links/eip712';
import { getStoredLinkRecord, isLinkRevoked } from '@/lib/links/store';
import { validateMultiProtocolAddress } from '@/lib/validators/address';
import { isTestnetChain } from '@/lib/socket/tokens';

export type LinkVerificationErrorCode =
  | 'UNSIGNED_LEGACY_LINK_REJECTED'
  | 'MALFORMED_LINK_PAYLOAD'
  | 'UNSUPPORTED_VERSION'
  | 'POLICY_HASH_MISMATCH'
  | 'INVALID_VAULT_ADDRESS'
  | 'INVALID_SIGNER_ADDRESS'
  | 'EXPIRED_LINK'
  | 'REVOKED_LINK'
  | 'INVALID_SIGNATURE'
  | 'EVM_VAULT_SIGNER_MISMATCH';

export interface VerifyPaymentLinkOptions {
  encodedPayload?: string | null;
  payload?: SignedPaymentLinkPayload | Record<string, unknown> | null;
  signature?: string | null;
  expectedHandle?: string | null;
  nowMs?: number;
  requireProvenEvmVault?: boolean;
  allowEmptySimulatorVault?: boolean;
  publicClient?: Pick<PublicClient, 'verifyTypedData'>;
}

export interface VerifyPaymentLinkResult {
  valid: boolean;
  errorCode?: LinkVerificationErrorCode;
  reason?: string;
  trustLevel?: LinkTrustLevel;
  erc1271ContractVerified?: boolean;
  payload?: SignedPaymentLinkPayload;
}

function getDefaultVerificationClient(): Pick<PublicClient, 'verifyTypedData'> {
  return createPublicClient({
    transport: http('https://ethereum-rpc.publicnode.com', { timeout: 2500 }),
  });
}

async function verifyTypedDataWithClientOrLocal(params: {
  address: `0x${string}`;
  typedData: ReturnType<typeof buildPaymentLinkTypedData>;
  signature: `0x${string}`;
  publicClient?: Pick<PublicClient, 'verifyTypedData'>;
}): Promise<boolean> {
  // 1. If a custom/mocked publicClient is passed (e.g., ERC-1271 smart-contract wallet verification), try it first
  if (params.publicClient) {
    try {
      const ok = await params.publicClient.verifyTypedData({
        address: params.address,
        domain: params.typedData.domain,
        types: params.typedData.types,
        primaryType: params.typedData.primaryType,
        message: params.typedData.message,
        signature: params.signature,
      });
      if (ok) return true;
    } catch {
      // Fall back to local secp256k1 recovery if RPC fails
    }
  }

  // 2. Local EOA EIP-712 verification (works 100% offline with zero RPC dependency)
  try {
    const localOk = await verifyTypedData({
      address: params.address,
      domain: params.typedData.domain,
      types: params.typedData.types,
      primaryType: params.typedData.primaryType,
      message: params.typedData.message,
      signature: params.signature,
    });
    if (localOk) return true;
  } catch {
    // Not a standard 65-byte EOA signature; may be an ERC-1271 contract signature
  }

  // 3. If no custom publicClient was injected and local EOA recovery returned false, try default publicClient ERC-1271 check
  if (!params.publicClient) {
    try {
      const client = getDefaultVerificationClient();
      return await client.verifyTypedData({
        address: params.address,
        domain: params.typedData.domain,
        types: params.typedData.types,
        primaryType: params.typedData.primaryType,
        message: params.typedData.message,
        signature: params.signature,
      });
    } catch {
      return false;
    }
  }

  return false;
}

export async function verifySignedPaymentLink(
  options: VerifyPaymentLinkOptions
): Promise<VerifyPaymentLinkResult> {
  let rawObj: Record<string, unknown> | null = null;

  if (options.payload && typeof options.payload === 'object') {
    rawObj = options.payload as Record<string, unknown>;
  } else if (options.encodedPayload) {
    try {
      const decodedJson = decodeBase64UrlToUtf8(options.encodedPayload);
      const parsed = JSON.parse(decodedJson);
      if (!parsed || typeof parsed !== 'object') {
        return {
          valid: false,
          errorCode: 'MALFORMED_LINK_PAYLOAD',
          reason: 'Decoded ?c= payload is not a JSON object.',
        };
      }
      rawObj = parsed as Record<string, unknown>;
    } catch {
      return {
        valid: false,
        errorCode: 'MALFORMED_LINK_PAYLOAD',
        reason: 'Failed to decode ?c= base64url JSON payload.',
      };
    }
  } else {
    return {
      valid: false,
      errorCode: 'UNSIGNED_LEGACY_LINK_REJECTED',
      reason: 'Missing payment link payload (?c=) and signature (?sig=).',
    };
  }

  // Detect old unsigned ?c= links (which had `vaultAddresses` map and lacked `linkId`, `policyHash`, `signer`, or `?sig=`)
  const sig = options.signature?.trim() ?? '';
  if (
    !sig ||
    !sig.startsWith('0x') ||
    rawObj.vaultAddresses !== undefined ||
    rawObj.linkId === undefined ||
    rawObj.policyHash === undefined ||
    rawObj.signer === undefined
  ) {
    return {
      valid: false,
      errorCode: 'UNSIGNED_LEGACY_LINK_REJECTED',
      reason:
        'Unsigned legacy ?c= payment links are rejected. Payment links must be EIP-712 signed by the receiver wallet (?c=<payload>&sig=<signature>).',
    };
  }

  const version = Number(rawObj.version);
  if (version !== 1) {
    return {
      valid: false,
      errorCode: 'UNSUPPORTED_VERSION',
      reason: `Unsupported payment link version: ${String(rawObj.version)}. Expected version 1.`,
    };
  }

  const signerStr = String(rawObj.signer ?? '').trim();
  if (!isAddress(signerStr, { strict: false })) {
    return {
      valid: false,
      errorCode: 'INVALID_SIGNER_ADDRESS',
      reason: `Invalid receiver signer EVM address: "${signerStr}".`,
    };
  }

  if (
    typeof rawObj.linkId !== 'string' ||
    !rawObj.linkId.trim() ||
    typeof rawObj.handle !== 'string' ||
    !rawObj.handle.trim() ||
    typeof rawObj.amount !== 'string' ||
    typeof rawObj.asset !== 'string' ||
    typeof rawObj.settlementMode !== 'string' ||
    typeof rawObj.vaultAddress !== 'string' ||
    typeof rawObj.policyHash !== 'string' ||
    typeof rawObj.createdAt !== 'string' ||
    typeof rawObj.expiresAt !== 'string' ||
    !rawObj.policy ||
    typeof rawObj.policy !== 'object'
  ) {
    return {
      valid: false,
      errorCode: 'MALFORMED_LINK_PAYLOAD',
      reason: 'Signed payment link payload is missing required fields.',
    };
  }

  const candidatePayload = canonicalizeSignedLinkPayload(
    rawObj as unknown as SignedPaymentLinkPayload
  );

  if (
    options.expectedHandle &&
    options.expectedHandle.trim().toLowerCase() !==
      candidatePayload.handle.toLowerCase()
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_SIGNATURE',
      reason: `URL route handle (${options.expectedHandle}) does not match signed link handle (${candidatePayload.handle}).`,
    };
  }

  // Check revocation status
  if (isLinkRevoked(candidatePayload.linkId)) {
    return {
      valid: false,
      errorCode: 'REVOKED_LINK',
      reason: `Payment link ${candidatePayload.linkId} has been revoked by the receiver.`,
    };
  }

  // Check expiration
  const now = options.nowMs ?? Date.now();
  const expiresMs = Date.parse(candidatePayload.expiresAt);
  if (!Number.isFinite(expiresMs) || now > expiresMs) {
    return {
      valid: false,
      errorCode: 'EXPIRED_LINK',
      reason: `Payment link expired at ${candidatePayload.expiresAt}.`,
    };
  }

  // Recompute policyHash from the full canonical policy in the URL payload and reject any mismatch
  const computedPolicyHash = computePolicyKeccak256(candidatePayload.policy);
  if (
    computedPolicyHash.toLowerCase() !==
    candidatePayload.policyHash.toLowerCase()
  ) {
    return {
      valid: false,
      errorCode: 'POLICY_HASH_MISMATCH',
      reason: `Policy tampering detected: payload policy keccak256 (${computedPolicyHash}) does not match signed policyHash (${candidatePayload.policyHash}).`,
    };
  }

  // Reject USDT on testnet chains per Issue 10
  if (
    isTestnetChain(candidatePayload.destinationChainId) &&
    candidatePayload.asset === 'USDT'
  ) {
    return {
      valid: false,
      errorCode: 'MALFORMED_LINK_PAYLOAD',
      reason:
        'USDT is not supported on testnet chains. Only USDC and ETH are supported on testnet.',
    };
  }

  // Validate vaultAddress for the chosen settlementMode
  const isVaultEmpty = !candidatePayload.vaultAddress.trim();
  if (isVaultEmpty && !options.allowEmptySimulatorVault) {
    return {
      valid: false,
      errorCode: 'INVALID_VAULT_ADDRESS',
      reason:
        'Destination vault address is empty. Link creation and settlement are blocked until a valid address is entered for the chosen mode.',
    };
  }
  if (!isVaultEmpty) {
    const vaultValidation = validateMultiProtocolAddress(
      candidatePayload.vaultAddress,
      candidatePayload.settlementMode
    );
    if (!vaultValidation.valid) {
      return {
        valid: false,
        errorCode: 'INVALID_VAULT_ADDRESS',
        reason:
          vaultValidation.errorMessage ??
          `Invalid vaultAddress for mode ${candidatePayload.settlementMode}.`,
      };
    }
  }

  const typedData = buildPaymentLinkTypedData(candidatePayload);
  const checksumSigner = getAddress(candidatePayload.signer);

  const signerValid = await verifyTypedDataWithClientOrLocal({
    address: checksumSigner,
    typedData,
    signature: sig as `0x${string}`,
    publicClient: options.publicClient,
  });

  if (!signerValid) {
    return {
      valid: false,
      errorCode: 'INVALID_SIGNATURE',
      reason:
        'EIP-712 signature verification failed: payload or signature was tampered or signed by a different wallet.',
    };
  }

  // Determine trust level:
  // - HANDLE_VERIFIED: handle is an ENS name that resolves to signer or vault
  // - SELF_SIGNED_VAULT: EVM_SOCKET and signer == vaultAddress (or vaultAddress is an ERC-1271 smart contract)
  // - SIGNED_UNPROVEN: BTC or XMR mode (or EVM where signer != vaultAddress and not ERC-1271 proven)
  if (candidatePayload.settlementMode === 'EVM_SOCKET') {
    const vaultLower = candidatePayload.vaultAddress.toLowerCase();
    const signerLower = candidatePayload.signer.toLowerCase();

    // Check if handle is an ENS name resolving to signer or vault
    let isEnsHandleVerified = false;
    if (candidatePayload.handle.endsWith('.eth')) {
      try {
        const rpcUrl = process.env.RPC_URL_1 || 'https://ethereum-rpc.publicnode.com';
        const ensClient = createPublicClient({
          chain: mainnet,
          transport: http(rpcUrl, { timeout: 2000 }),
        });
        const resolved = await ensClient.getEnsAddress({ name: candidatePayload.handle });
        if (resolved && (resolved.toLowerCase() === signerLower || resolved.toLowerCase() === vaultLower)) {
          isEnsHandleVerified = true;
        }
      } catch {
        // Network/offline fallback
      }
    }

    if (vaultLower === signerLower) {
      return {
        valid: true,
        trustLevel: isEnsHandleVerified ? 'HANDLE_VERIFIED' : 'SELF_SIGNED_VAULT',
        erc1271ContractVerified: false,
        payload: candidatePayload,
      };
    }

    // Check if vaultAddress is an ERC-1271 smart-contract wallet controlled by signer
    let isErc1271VaultValid = false;
    if (isAddress(candidatePayload.vaultAddress, { strict: false })) {
      const rpcUrl =
        process.env[`RPC_URL_${candidatePayload.destinationChainId}`] ||
        process.env.RPC_URL_1 ||
        'https://ethereum-rpc.publicnode.com';
      const client =
        options.publicClient ??
        createPublicClient({
          chain: mainnet,
          transport: http(rpcUrl, { timeout: 2500 }),
        });

      try {
        if ('getCode' in client && typeof client.getCode === 'function') {
          const code = await client.getCode({
            address: getAddress(candidatePayload.vaultAddress),
          });
          if (code && code !== '0x') {
            isErc1271VaultValid = await client.verifyTypedData({
              address: getAddress(candidatePayload.vaultAddress),
              domain: typedData.domain,
              types: typedData.types,
              primaryType: typedData.primaryType,
              message: typedData.message,
              signature: sig as `0x${string}`,
            });
          }
        } else {
          isErc1271VaultValid = await client.verifyTypedData({
            address: getAddress(candidatePayload.vaultAddress),
            domain: typedData.domain,
            types: typedData.types,
            primaryType: typedData.primaryType,
            message: typedData.message,
            signature: sig as `0x${string}`,
          });
        }
      } catch {
        isErc1271VaultValid = false;
      }
    }

    if (isErc1271VaultValid) {
      return {
        valid: true,
        trustLevel: isEnsHandleVerified ? 'HANDLE_VERIFIED' : 'SELF_SIGNED_VAULT',
        erc1271ContractVerified: true,
        payload: candidatePayload,
      };
    }

    if (options.requireProvenEvmVault) {
      return {
        valid: false,
        errorCode: 'EVM_VAULT_SIGNER_MISMATCH',
        reason: `EVM payout vault (${candidatePayload.vaultAddress}) does not match link signer (${candidatePayload.signer}) and did not pass ERC-1271 smart wallet verification.`,
      };
    }

    return {
      valid: true,
      trustLevel: 'SIGNED_UNPROVEN',
      erc1271ContractVerified: false,
      payload: candidatePayload,
    };
  }

  return {
    valid: true,
    trustLevel: 'SIGNED_UNPROVEN',
    erc1271ContractVerified: false,
    payload: candidatePayload,
  };
}

export async function verifyRevokeLinkSignature(params: {
  revokeMessage: RevokeLinkMessage;
  signature: `0x${string}`;
  originalLinkPayload?: string | null;
  originalLinkSignature?: string | null;
  publicClient?: Pick<PublicClient, 'verifyTypedData'>;
}): Promise<{
  valid: boolean;
  reason?: string;
}> {
  if (!isAddress(params.revokeMessage.signer, { strict: false })) {
    return { valid: false, reason: 'Invalid revoke signer address.' };
  }

  // Validate issuedAt freshness (±10 minutes per P0-3)
  const now = Date.now();
  const rawIssued = params.revokeMessage.issuedAt;
  let issuedMs = Date.parse(rawIssued);
  if (!Number.isFinite(issuedMs) && /^\d+$/.test(rawIssued)) {
    const num = Number(rawIssued);
    issuedMs = num < 1e11 ? num * 1000 : num;
  }
  if (!Number.isFinite(issuedMs) || Math.abs(now - issuedMs) > 10 * 60 * 1000) {
    return {
      valid: false,
      reason: 'Revocation issuedAt timestamp is expired or outside the freshness window (±10 minutes).',
    };
  }

  const stored = getStoredLinkRecord(params.revokeMessage.linkId);
  if (stored) {
    if (
      stored.payload.signer.toLowerCase() !==
      params.revokeMessage.signer.trim().toLowerCase()
    ) {
      return {
        valid: false,
        reason: `Revoke signer (${params.revokeMessage.signer}) does not match the original link signer (${stored.payload.signer}).`,
      };
    }
  } else if (params.originalLinkPayload && params.originalLinkSignature) {
    // If not stored in memory (e.g. server restart or stateless URL link), verify the original link
    const origCheck = await verifySignedPaymentLink({
      encodedPayload: params.originalLinkPayload,
      signature: params.originalLinkSignature,
      publicClient: params.publicClient,
    });
    if (!origCheck.valid || !origCheck.payload) {
      return {
        valid: false,
        reason: `Original payment link proof is invalid: ${origCheck.reason ?? 'verification failed'}.`,
      };
    }
    if (
      origCheck.payload.linkId.toLowerCase() !==
      params.revokeMessage.linkId.toLowerCase()
    ) {
      return {
        valid: false,
        reason: `Original linkId (${origCheck.payload.linkId}) does not match revocation linkId (${params.revokeMessage.linkId}).`,
      };
    }
    if (
      origCheck.payload.signer.toLowerCase() !==
      params.revokeMessage.signer.trim().toLowerCase()
    ) {
      return {
        valid: false,
        reason: `Revoke signer (${params.revokeMessage.signer}) does not match original link signer (${origCheck.payload.signer}).`,
      };
    }
  } else {
    return {
      valid: false,
      reason:
        'Payment link is not in server memory registry. To revoke an unindexed or stateless link, supply the original signed link payload (c) and signature (sig) to prove authorship.',
    };
  }

  const typedData = buildRevokeLinkTypedData(params.revokeMessage);
  const checksumSigner = getAddress(params.revokeMessage.signer);

  let sigOk = false;
  if (params.publicClient) {
    try {
      sigOk = await params.publicClient.verifyTypedData({
        address: checksumSigner,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
        signature: params.signature,
      });
    } catch {
      sigOk = false;
    }
  }

  if (!sigOk) {
    try {
      sigOk = await verifyTypedData({
        address: checksumSigner,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
        signature: params.signature,
      });
    } catch {
      sigOk = false;
    }
  }

  if (!sigOk) {
    return {
      valid: false,
      reason: 'Invalid EIP-712 Revoke signature.',
    };
  }

  return { valid: true };
}
