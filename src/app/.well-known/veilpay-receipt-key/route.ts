import { NextResponse } from 'next/server';
import { getReceiptPublicKeyInfo } from '@/lib/aigi/receipt-signer';

export async function GET() {
  const keyInfo = getReceiptPublicKeyInfo();
  return NextResponse.json(keyInfo, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Type': 'application/json',
    },
  });
}
