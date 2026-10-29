import { NextResponse } from 'next/server';
import { getLiveSpotRates } from '@/lib/rates';

export async function GET() {
  try {
    const payload = await getLiveSpotRates();
    return NextResponse.json({
      ok: true,
      rates: payload.rates,
      fetchedAt: payload.fetchedAt,
      expiresAt: payload.expiresAt,
      source: payload.source,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        rates: null,
        error:
          err instanceof Error
            ? err.message
            : 'Spot rates unavailable from public price oracle.',
      },
      { status: 503 }
    );
  }
}
