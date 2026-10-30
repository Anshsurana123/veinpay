import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  canonicalizePolicy,
  computePolicyKeccak256,
  encodeSignedLinkPayloadToBase64Url,
  serializeCanonicalPolicyJson,
} from '@/lib/links/canonical';
import {
  buildPaymentLinkTypedData,
  buildRevokeLinkTypedData,
  createPaymentLinkPayload,
} from '@/lib/links/eip712';
import { markLinkRevoked, storeSignedLinkRecord } from '@/lib/links/store';
import {
  verifyRevokeLinkSignature,
  verifySignedPaymentLink,
} from '@/lib/links/verify';
import { DEMO_CAKE_VAULT_ADDRESSES } from '@/lib/demo-fixtures';
import type { FirewallPolicyConfig, SignedPaymentLinkPayload } from '@/types/veilpay';

const RECEIVER_ACCOUNT = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
);
const ATTACKER_ACCOUNT = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
);

const BASE_POLICY: FirewallPolicyConfig = {
  firewallEnabled: true,
  maxHops: 3,
  cleanLinkEnabled: true,
  unbundleEnabled: true,
  sybilBlockThreshold: 10,
  socketAutoBridgeEnabled: true,
  inconclusivePolicy: 'BLOCK',
};

async function createSignedTestLink(
  overrides?: Partial<Parameters<typeof createPaymentLinkPayload>[0]>
) {
  const payload = createPaymentLinkPayload({
    handle: 'ansh-audit',
    amount: '250.00',
    asset: 'USDC',
    destinationChainId: 8453,
    settlementMode: 'EVM_SOCKET',
    vaultAddress: RECEIVER_ACCOUNT.address,
    policy: BASE_POLICY,
    signer: RECEIVER_ACCOUNT.address,
    ...overrides,
  });
  const sig = await RECEIVER_ACCOUNT.signTypedData(
    buildPaymentLinkTypedData(payload)
  );
  const c = encodeSignedLinkPayloadToBase64Url(payload);
  return { payload, sig, c };
}

describe('EIP-712 Receiver-Signed Payment Links (Issue 4)', () => {
  it('Canonicalizes policy deterministically regardless of key order', () => {
    const policyA = {
      socketAutoBridgeEnabled: true,
      maxHops: 3 as const,
      firewallEnabled: true,
      inconclusivePolicy: 'BLOCK' as const,
      sybilBlockThreshold: 10,
      unbundleEnabled: true,
      cleanLinkEnabled: true,
    };
    const policyB = {
      cleanLinkEnabled: true,
      firewallEnabled: true,
      inconclusivePolicy: 'BLOCK' as const,
      maxHops: 3 as const,
      socketAutoBridgeEnabled: true,
      sybilBlockThreshold: 10,
      unbundleEnabled: true,
    };

    expect(serializeCanonicalPolicyJson(policyA)).toBe(
      serializeCanonicalPolicyJson(policyB)
    );
    expect(computePolicyKeccak256(policyA)).toBe(
      computePolicyKeccak256(policyB)
    );
    expect(canonicalizePolicy(policyA)).toEqual(canonicalizePolicy(policyB));
  });

  it('Verifies valid EVM payment link where signer == vaultAddress as PROVEN', async () => {
    const { c, sig, payload } = await createSignedTestLink();
    const res = await verifySignedPaymentLink({
      encodedPayload: c,
      signature: sig,
    });
    expect(res.valid).toBe(true);
    expect(res.trustLevel).toBe('PROVEN');
    expect(res.payload?.linkId).toBe(payload.linkId);
  });

  it(
    'Rejects tampering of every signed field and policy property',
    async () => {
      const { payload, sig } = await createSignedTestLink();

    const fieldMutations: Array<
      (base: SignedPaymentLinkPayload) => SignedPaymentLinkPayload
    > = [
      (b) => ({ ...b, handle: 'tampered-handle' }),
      (b) => ({ ...b, amount: '10.00' }),
      (b) => ({ ...b, asset: 'ETH' }),
      (b) => ({ ...b, destinationChainId: 42161 }),
      (b) => ({
        ...b,
        settlementMode: 'BTC_SILENT_PAYMENT',
        vaultAddress: DEMO_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
      }),
      (b) => ({ ...b, vaultAddress: ATTACKER_ACCOUNT.address.toLowerCase() }),
      (b) => ({
        ...b,
        createdAt: new Date(Date.parse(b.createdAt) + 10000).toISOString(),
      }),
      (b) => ({
        ...b,
        expiresAt: new Date(Date.parse(b.expiresAt) + 3600000).toISOString(),
      }),
      (b) => ({
        ...b,
        signer: ATTACKER_ACCOUNT.address.toLowerCase() as `0x${string}`,
      }),
      (b) => ({
        ...b,
        policy: { ...b.policy, firewallEnabled: false },
      }),
      (b) => ({
        ...b,
        policy: { ...b.policy, maxHops: 1 },
      }),
      (b) => ({
        ...b,
        policy: { ...b.policy, sybilBlockThreshold: 25 },
      }),
      (b) => ({
        ...b,
        policy: { ...b.policy, inconclusivePolicy: 'WARN' },
      }),
    ];

    for (const mutate of fieldMutations) {
      const mutatedPayload = mutate(structuredClone(payload));
      const tamperedC = encodeSignedLinkPayloadToBase64Url(mutatedPayload);
      const verifyRes = await verifySignedPaymentLink({
        encodedPayload: tamperedC,
        signature: sig,
      });
      expect(verifyRes.valid).toBe(false);
    }
  }, 20000);

  it('Rejects signature from wrong signer', async () => {
    const { payload, c } = await createSignedTestLink();
    const attackerSig = await ATTACKER_ACCOUNT.signTypedData(
      buildPaymentLinkTypedData(payload)
    );
    const res = await verifySignedPaymentLink({
      encodedPayload: c,
      signature: attackerSig,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('signature verification failed');
  });

  it('Rejects expired payment links', async () => {
    const pastNowMs = 1700000000000;
    const { c, sig } = await createSignedTestLink({
      nowMs: pastNowMs - 7 * 24 * 3600 * 1000,
      ttlDays: 1,
    });
    const res = await verifySignedPaymentLink({
      encodedPayload: c,
      signature: sig,
      nowMs: pastNowMs,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('expired');
  });

  it('Verifies EIP-712 Revoke signature and rejects revoked links', async () => {
    const { payload, c, sig } = await createSignedTestLink();
    storeSignedLinkRecord({
      payload,
      encodedPayload: c,
      signature: sig,
      trustLevel: 'PROVEN',
    });

    const issuedAt = new Date().toISOString();
    const revokeSig = await RECEIVER_ACCOUNT.signTypedData(
      buildRevokeLinkTypedData({
        linkId: payload.linkId,
        signer: RECEIVER_ACCOUNT.address,
        issuedAt,
      })
    );

    const revokeCheck = await verifyRevokeLinkSignature({
      revokeMessage: {
        linkId: payload.linkId,
        signer: RECEIVER_ACCOUNT.address,
        issuedAt,
      },
      signature: revokeSig,
    });
    expect(revokeCheck.valid).toBe(true);

    markLinkRevoked({
      linkId: payload.linkId,
      signer: RECEIVER_ACCOUNT.address,
      issuedAt,
    });
    const afterRevoke = await verifySignedPaymentLink({
      encodedPayload: c,
      signature: sig,
    });
    expect(afterRevoke.valid).toBe(false);
    expect(afterRevoke.reason).toContain('revoked');
  });

  it('Marks BTC/XMR links and EVM links where signer != vaultAddress as SIGNED_UNPROVEN, and supports ERC-1271 contract signers', async () => {
    // EVM link where signer != vaultAddress (EOA signing for another EOA)
    const diffVault = await createSignedTestLink({
      vaultAddress: ATTACKER_ACCOUNT.address,
    });
    const diffRes = await verifySignedPaymentLink({
      encodedPayload: diffVault.c,
      signature: diffVault.sig,
    });
    expect(diffRes.valid).toBe(true);
    expect(diffRes.trustLevel).toBe('SIGNED_UNPROVEN');

    // BTC Silent Payment link
    const btcLink = await createSignedTestLink({
      settlementMode: 'BTC_SILENT_PAYMENT',
      asset: 'BTC',
      vaultAddress: DEMO_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
    });
    const btcRes = await verifySignedPaymentLink({
      encodedPayload: btcLink.c,
      signature: btcLink.sig,
    });
    expect(btcRes.valid).toBe(true);
    expect(btcRes.trustLevel).toBe('SIGNED_UNPROVEN');

    // Mocked ERC-1271 smart-contract wallet signer where signer == smart-contract vaultAddress
    const smartContractVault =
      '0x1111111111111111111111111111111111111111' as const;
    const scPayload = createPaymentLinkPayload({
      handle: 'safe-multisig',
      amount: '500.00',
      asset: 'USDC',
      destinationChainId: 8453,
      settlementMode: 'EVM_SOCKET',
      vaultAddress: smartContractVault,
      policy: BASE_POLICY,
      signer: smartContractVault,
    });
    const scC = encodeSignedLinkPayloadToBase64Url(scPayload);
    const mock1271Sig =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b' as const;

    const scRes = await verifySignedPaymentLink({
      encodedPayload: scC,
      signature: mock1271Sig,
      publicClient: {
        verifyTypedData: async (params) =>
          params.address.toLowerCase() === smartContractVault.toLowerCase() &&
          params.signature === mock1271Sig,
      },
    });
    expect(scRes.valid).toBe(true);
    expect(scRes.trustLevel).toBe('PROVEN');
  });

  it('Rejects legacy unsigned ?c= links with a clear error message', async () => {
    const legacyUnsignedJson = JSON.stringify({
      handle: 'legacy-unsigned',
      amount: '250.00',
      asset: 'USDC',
      destinationChainId: 8453,
      settlementMode: 'EVM_SOCKET',
      vaultAddresses: DEMO_CAKE_VAULT_ADDRESSES,
      policy: BASE_POLICY,
    });
    const legacyC = Buffer.from(legacyUnsignedJson, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const missingSigRes = await verifySignedPaymentLink({
      encodedPayload: legacyC,
      signature: null,
    });
    expect(missingSigRes.valid).toBe(false);
    expect(missingSigRes.reason).toContain('Unsigned legacy');

    const withFakeSigRes = await verifySignedPaymentLink({
      encodedPayload: legacyC,
      signature: '0xdeadbeef',
    });
    expect(withFakeSigRes.valid).toBe(false);
    expect(withFakeSigRes.reason).toContain('Unsigned legacy');
  });

  it('Prevents unauthorized revocation of unstored or stateless links without author proof', async () => {
    // Legitimate link created by RECEIVER_ACCOUNT
    const link = await createSignedTestLink({ handle: 'legit-unindexed' });
    const linkId = link.payload.linkId;

    // Attacker tries to revoke linkId by signing a Revoke message with ATTACKER_ACCOUNT
    const attackerRevokeMsg = {
      linkId,
      signer: ATTACKER_ACCOUNT.address,
      issuedAt: new Date().toISOString(),
    };
    const attackerSig = await ATTACKER_ACCOUNT.signTypedData(
      buildRevokeLinkTypedData(attackerRevokeMsg)
    );

    // Should FAIL because link is not in memory and attacker provided no proof of authorship
    const unprovenRes = await verifyRevokeLinkSignature({
      revokeMessage: attackerRevokeMsg,
      signature: attackerSig,
    });
    expect(unprovenRes.valid).toBe(false);
    expect(unprovenRes.reason).toContain('not in server memory registry');

    // If attacker attempts to supply the legit link's `c` and `sig` but signs the revoke message with attacker key:
    const mismatchRes = await verifyRevokeLinkSignature({
      revokeMessage: attackerRevokeMsg,
      signature: attackerSig,
      originalLinkPayload: link.c,
      originalLinkSignature: link.sig,
    });
    expect(mismatchRes.valid).toBe(false);
    expect(mismatchRes.reason).toContain('does not match original link signer');

    // Author signs revocation and provides original link proof
    const authorRevokeMsg = {
      linkId,
      signer: RECEIVER_ACCOUNT.address,
      issuedAt: new Date().toISOString(),
    };
    const authorSig = await RECEIVER_ACCOUNT.signTypedData(
      buildRevokeLinkTypedData(authorRevokeMsg)
    );

    const authorRes = await verifyRevokeLinkSignature({
      revokeMessage: authorRevokeMsg,
      signature: authorSig,
      originalLinkPayload: link.c,
      originalLinkSignature: link.sig,
    });
    expect(authorRes.valid).toBe(true);
  });
});
