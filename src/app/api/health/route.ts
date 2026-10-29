import { NextRequest, NextResponse } from 'next/server';
import { checkIntegrationsHealth } from '@/lib/health';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const skipPing = sp.get('ping') === 'false';

  const health = await checkIntegrationsHealth(skipPing);

  return NextResponse.json(health, {
    status: health.healthy ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
