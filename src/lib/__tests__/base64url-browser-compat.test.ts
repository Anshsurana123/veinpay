import { describe, expect, it } from 'vitest';
import {
  decodeBase64UrlToUtf8,
  encodeSignedLinkPayloadToBase64Url,
  base64ToBase64Url,
  base64UrlToBase64,
} from '@/lib/links/canonical';
import { createPaymentLinkPayload } from '@/lib/links/eip712';
import {
  signProofOfControlToken,
  verifyProofOfControlToken,
} from '@/lib/session/proof-of-control';
import {
  signScanAttestation,
  verifyScanAttestation,
} from '@/lib/security/attestation';

describe('Base64URL browser polyfill compatibility', () => {
  it('converts base64 to base64url and back accurately without trailing padding', () => {
    // 1-byte, 2-byte, 3-byte inputs produce different padding lengths (2, 1, 0 pads)
    const inputs = ['a', 'ab', 'abc', 'hello world!>>>???'];
    for (const str of inputs) {
      const origBase64 = Buffer.from(str, 'utf8').toString('base64');
      const urlSafe = base64ToBase64Url(origBase64);
      expect(urlSafe).not.toContain('+');
      expect(urlSafe).not.toContain('/');
      expect(urlSafe).not.toContain('=');

      const restoredBase64 = base64UrlToBase64(urlSafe);
      expect(restoredBase64).toBe(origBase64);
      expect(Buffer.from(restoredBase64, 'base64').toString('utf8')).toBe(str);
    }
  });

  it('encodes and decodes signed payment link payloads without using base64url Buffer encoding', () => {
    const payload = createPaymentLinkPayload({
      handle: 'ansh-test',
      amount: '100.00',
      asset: 'USDC',
      destinationChainId: 8453,
      settlementMode: 'EVM_SOCKET',
      vaultAddress: '0x1111111111111111111111111111111111111111',
      policy: {
        firewallEnabled: true,
        maxHops: 3,
        cleanLinkEnabled: true,
        unbundleEnabled: true,
        sybilBlockThreshold: 10,
        socketAutoBridgeEnabled: true,
        inconclusivePolicy: 'BLOCK',
      },
      signer: '0x1111111111111111111111111111111111111111',
    });

    // Simulate browser Buffer polyfill that does NOT support 'base64url' encoding
    const origToString = Buffer.prototype.toString;
    const origFrom = Buffer.from;

    try {
      // Monkey-patch Buffer.prototype.toString to throw if 'base64url' is requested
      Buffer.prototype.toString = function (this: Buffer, encoding?: string, ...args: unknown[]) {
        if (encoding === 'base64url') {
          throw new TypeError('Unknown encoding: base64url');
        }
        return (origToString as Function).apply(this, [encoding, ...args]);
      } as typeof Buffer.prototype.toString;

      // Also ensure Buffer.from with 'base64url' throws
      const customFrom = function (...args: unknown[]) {
        if (args[1] === 'base64url') {
          throw new TypeError('Unknown encoding: base64url');
        }
        return (origFrom as Function).apply(Buffer, args);
      };
      Buffer.from = customFrom as unknown as typeof Buffer.from;

      // Encoding should succeed without calling toString('base64url')
      const encoded = encodeSignedLinkPayloadToBase64Url(payload);
      expect(encoded).toBeTruthy();
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');

      // Decoding should succeed
      const decodedJson = decodeBase64UrlToUtf8(encoded);
      const parsed = JSON.parse(decodedJson);
      expect(parsed.handle).toBe('ansh-test');
      expect(parsed.amount).toBe('100.00');

      // Proof of control token should sign & verify safely
      const pocToken = signProofOfControlToken({
        chainId: 8453,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        linkId: payload.linkId,
        nonce: '0xabc123',
        proofOfControl: true,
        scannedAddress: '0x1111111111111111111111111111111111111111',
        vaultAddress: '0x1111111111111111111111111111111111111111',
      });
      const pocRes = verifyProofOfControlToken(pocToken, {
        scannedAddress: '0x1111111111111111111111111111111111111111',
      });
      expect(pocRes.valid).toBe(true);

      // Scan attestation should sign & verify safely
      const attestation = signScanAttestation({
        linkId: payload.linkId,
        linkSigner: '0x1111111111111111111111111111111111111111',
        payer: '0x1111111111111111111111111111111111111111',
        policy: payload.policy,
        proofOfControl: true,
        socketUnlocked: true,
        verdict: 'VERIFIED_CLEAN',
      });
      const attRes = verifyScanAttestation(attestation, {
        payer: '0x1111111111111111111111111111111111111111',
      });
      expect(attRes.valid).toBe(true);
    } finally {
      Buffer.prototype.toString = origToString;
      Buffer.from = origFrom;
    }
  });
});
