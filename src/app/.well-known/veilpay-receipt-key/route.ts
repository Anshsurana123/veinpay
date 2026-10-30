import { NextResponse } from 'next/server';
import {
  getAllReceiptPublicKeys,
  getReceiptPublicKeyInfo,
} from '@/lib/aigi/receipt-signer';

export async function GET() {
  const active = getReceiptPublicKeyInfo();
  const allKeys = getAllReceiptPublicKeys();
  const jwks = allKeys.map((k) => k.jwk);

  return NextResponse.json(
    {
      keyId: active.keyId,
      algorithm: active.algorithm,
      publicKeyHex: active.publicKeyHex,
      publicKeyPem: active.publicKeyPem,
      jwk: active.jwk,
      keys: jwks,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'Content-Type': 'application/json',
      },
    }
  );
}
