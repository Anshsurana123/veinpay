import { describe, expect, it } from 'vitest';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';
import {
  generateAigiForensicReceipt,
  sha256HexSync,
} from '@/lib/aigi/verdict';
import {
  DEFAULT_RECEIPT_KEY_ID,
  getReceiptPublicKeyInfo,
  signReceiptCommitmentHash,
  verifyReceiptSignature,
} from '@/lib/aigi/receipt-signer';
import { POST } from '@/app/api/aigi/verify/route';
import { POST as postVerdict } from '@/app/api/aigi/verdict/route';
import { GET as getWellKnownKey } from '@/app/.well-known/veilpay-receipt-key/route';
import { NextRequest } from 'next/server';

describe('Issue 13: Ed25519 Signed Forensic Receipts & Verification', () => {
  const sampleScan = runVeilPayFirewallTraversal({
    targetWallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
    merchantWallet: '0x1111111111111111111111111111111111111111',
    policy: {
      firewallEnabled: true,
      maxHops: 3,
      cleanLinkEnabled: true,
      unbundleEnabled: true,
      socketAutoBridgeEnabled: true,
      sybilBlockThreshold: 10,
    },
  });

  it('generates an Ed25519 signature and keyId over the commitment hash', () => {
    const receipt = generateAigiForensicReceipt(sampleScan);

    expect(receipt.cryptographicAuditHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt.commitmentHash).toBe(receipt.cryptographicAuditHash);
    expect(receipt.signature).toBeDefined();
    expect(receipt.signature).toMatch(/^0x[0-9a-f]{128}$/);
    expect(receipt.keyId).toBe(DEFAULT_RECEIPT_KEY_ID);
  });

  it('preserves 100% hash determinism across runs for identical graph state', () => {
    const receipt1 = generateAigiForensicReceipt(sampleScan);
    const receipt2 = generateAigiForensicReceipt(sampleScan);

    expect(receipt1.cryptographicAuditHash).toBe(receipt2.cryptographicAuditHash);
    expect(receipt1.canonicalPayloadJson).toBe(receipt2.canonicalPayloadJson);
  });

  it('verifies the Ed25519 signature successfully with verifyReceiptSignature', () => {
    const receipt = generateAigiForensicReceipt(sampleScan);

    const result = verifyReceiptSignature({
      commitmentHash: receipt.cryptographicAuditHash,
      signature: receipt.signature!,
      keyId: receipt.keyId,
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('rejects tampered commitment hash or signature', () => {
    const receipt = generateAigiForensicReceipt(sampleScan);

    // Tampered hash
    const tamperedHash =
      receipt.cryptographicAuditHash.slice(0, -4) + 'abcd';
    const badHashRes = verifyReceiptSignature({
      commitmentHash: tamperedHash,
      signature: receipt.signature!,
    });
    expect(badHashRes.valid).toBe(false);

    // Tampered signature
    const tamperedSig =
      receipt.signature!.slice(0, -4) + '0000';
    const badSigRes = verifyReceiptSignature({
      commitmentHash: receipt.cryptographicAuditHash,
      signature: tamperedSig,
    });
    expect(badSigRes.valid).toBe(false);
  });

  it('serves the Ed25519 public key at /.well-known/veilpay-receipt-key', async () => {
    const res = await getWellKnownKey();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.keyId).toBe(DEFAULT_RECEIPT_KEY_ID);
    expect(json.algorithm).toBe('Ed25519');
    expect(json.publicKeyHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(json.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(json.jwk.kty).toBe('OKP');
    expect(json.jwk.crv).toBe('Ed25519');
  });

  it('POST /api/aigi/verify verifies authentic receipts and rejects tampered ones', async () => {
    const receipt = generateAigiForensicReceipt(sampleScan);

    // Valid receipt verification
    const reqValid = new NextRequest('http://localhost:3000/api/aigi/verify', {
      method: 'POST',
      body: JSON.stringify({ receipt }),
    });
    const resValid = await POST(reqValid);
    expect(resValid.status).toBe(200);
    const jsonValid = await resValid.json();
    expect(jsonValid.valid).toBe(true);
    expect(jsonValid.verified).toBe(true);
    expect(jsonValid.commitmentHash).toBe(receipt.cryptographicAuditHash);

    // Tampered canonical JSON
    const tamperedPayloadJson = receipt.canonicalPayloadJson.replace(
      'INTERCEPTED_TAINT',
      'VERIFIED_CLEAN'
    );
    const reqTampered = new NextRequest(
      'http://localhost:3000/api/aigi/verify',
      {
        method: 'POST',
        body: JSON.stringify({
          canonicalPayloadJson: tamperedPayloadJson,
          commitmentHash: receipt.cryptographicAuditHash,
          signature: receipt.signature,
        }),
      }
    );
    const resTampered = await POST(reqTampered);
    expect(resTampered.status).toBe(400);
    const jsonTampered = await resTampered.json();
    expect(jsonTampered.valid).toBe(false);
    expect(jsonTampered.error).toBe('COMMITMENT_HASH_MISMATCH');
  });

  it('POST /api/aigi/verdict rejects client scan verdict tampering', async () => {
    // 0x99B1c402881a77e3d90123456789aB00000FDead is a confirmed drainer (INTERCEPTED_TAINT)
    const forgedClientScan = {
      ...sampleScan,
      verdict: 'VERIFIED_CLEAN', // Attacker claims drainer is VERIFIED_CLEAN
    };

    const req = new NextRequest('http://localhost:3000/api/aigi/verdict', {
      method: 'POST',
      body: JSON.stringify({
        scan: forgedClientScan,
      }),
    });

    const res = await postVerdict(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('TAMPERED_SCAN_VERDICT');
  });
});
