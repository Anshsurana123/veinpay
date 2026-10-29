import { NextRequest, NextResponse } from 'next/server';
import { fetchCctpAttestationOnce } from '@/lib/cctp/attestation';
import { getCctpDomainForChain } from '@/lib/cctp/contracts';

const ipWindowMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkLocalRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const current = ipWindowMap.get(ip);
  if (!current || now >= current.resetAt) {
    ipWindowMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (current.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterMs: current.resetAt - now };
  }
  current.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  const rateCheck = checkLocalRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded for CCTP attestation polling.',
        retryAfterMs: rateCheck.retryAfterMs,
      },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const transactionHash = searchParams.get('transactionHash') ?? '';
  const sourceDomainParam = searchParams.get('sourceDomain');
  const sourceChainIdParam = searchParams.get('sourceChainId');

  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    return NextResponse.json(
      { error: 'Valid 32-byte hex transactionHash is required.' },
      { status: 400 }
    );
  }

  let sourceDomain: number | null =
    sourceDomainParam !== null && /^\d+$/.test(sourceDomainParam)
      ? Number(sourceDomainParam)
      : null;

  if (sourceDomain === null && sourceChainIdParam !== null && /^\d+$/.test(sourceChainIdParam)) {
    sourceDomain = getCctpDomainForChain(Number(sourceChainIdParam));
  }

  if (sourceDomain === null || ![0, 2, 3, 6, 7].includes(sourceDomain)) {
    return NextResponse.json(
      { error: 'Valid CCTP V2 testnet sourceDomain (0, 2, 3, 6, 7) or sourceChainId is required.' },
      { status: 400 }
    );
  }

  const result = await fetchCctpAttestationOnce({
    sourceDomain,
    transactionHash: transactionHash as `0x${string}`,
  });

  if (result.state === 'ERROR') {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result, { status: 200 });
}
