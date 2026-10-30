import { NextRequest, NextResponse } from 'next/server';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface RateLimiterOptions {
  limit?: number;
  windowSeconds?: number;
}

interface InMemoryRecord {
  count: number;
  resetAt: number;
}

const memoryRateLimitStore = new Map<string, InMemoryRecord>();

export function clearRateLimitsForTesting(): void {
  memoryRateLimitStore.clear();
}

export function getClientIp(request: Request | NextRequest): string {
  // 1. Direct NextRequest.ip (provided reliably by Next.js / Vercel Edge Runtime)
  if ('ip' in request && typeof (request as { ip?: string }).ip === 'string') {
    const directIp = (request as { ip?: string }).ip?.trim();
    if (directIp) return directIp;
  }

  // 2. Vercel Edge Forwarded IP
  const vercelIp = request.headers.get('x-vercel-forwarded-for');
  if (vercelIp?.trim()) {
    const first = vercelIp.split(',')[0].trim();
    if (first) return first;
  }

  // 3. Cloudflare Connecting IP
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp?.trim()) return cfIp.trim();

  // 4. True-Client-IP (Cloudflare Enterprise / Akamai)
  const trueClientIp = request.headers.get('true-client-ip');
  if (trueClientIp?.trim()) return trueClientIp.trim();

  // 5. Standard X-Real-IP
  const realIp = request.headers.get('x-real-ip');
  if (realIp?.trim()) return realIp.trim();

  // 6. X-Forwarded-For (take the client-most address)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }

  return '127.0.0.1';
}

export async function checkRateLimit(
  routeKey: string,
  ip: string,
  options?: RateLimiterOptions
): Promise<RateLimitResult> {
  const limit = options?.limit ?? 30;
  const windowSeconds = options?.windowSeconds ?? 60;
  const cacheKey = `ratelimit:${routeKey}:${ip}`;

  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, '');
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (restUrl && restToken) {
    try {
      const res = await fetch(restUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${restToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['INCR', cacheKey]),
        signal: AbortSignal.timeout(2000),
      });

      if (res.ok) {
        const data = (await res.json()) as { result: number };
        const currentCount = Number(data.result);

        if (currentCount === 1) {
          // Set TTL on first hit in window
          void fetch(restUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${restToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(['EXPIRE', cacheKey, windowSeconds]),
            signal: AbortSignal.timeout(1500),
          }).catch(() => {});
        }

        if (currentCount > limit) {
          return {
            allowed: false,
            limit,
            remaining: 0,
            resetSeconds: windowSeconds,
          };
        }

        return {
          allowed: true,
          limit,
          remaining: Math.max(0, limit - currentCount),
          resetSeconds: windowSeconds,
        };
      }
    } catch {
      // Fallback to in-memory store if Redis REST fails or times out
    }
  }

  // In-memory sliding window fallback (dev mode, tests, or redis outage)
  const now = Date.now();
  const existing = memoryRateLimitStore.get(cacheKey);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowSeconds * 1000;
    memoryRateLimitStore.set(cacheKey, { count: 1, resetAt });
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetSeconds: windowSeconds,
    };
  }

  existing.count += 1;
  const resetSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count > limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetSeconds,
    };
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetSeconds,
  };
}

export function buildRateLimitExceededResponse(
  result: RateLimitResult,
  customMessage?: string
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      statusCode: 429,
      error: 'RATE_LIMIT_EXCEEDED',
      message:
        customMessage ??
        `Rate limit exceeded. Maximum ${result.limit} requests per window. Try again in ${result.resetSeconds}s.`,
      retryAfterSeconds: result.resetSeconds,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.resetSeconds),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
      },
    }
  );
}
