import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';

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
  // 1. Explicitly trusted header via TRUSTED_IP_HEADER env var
  const trustedHeader = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (trustedHeader) {
    const val = request.headers.get(trustedHeader);
    if (val?.trim()) {
      const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
      return parts[0] || '127.0.0.1';
    }
  }

  // 2. Platform-set trusted headers (cannot be forged by clients behind edge proxies)
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp?.trim()) return cfIp.trim();

  const vercelIp = request.headers.get('x-vercel-forwarded-for');
  if (vercelIp?.trim()) {
    const first = vercelIp.split(',')[0].trim();
    if (first) return first;
  }

  const trueClientIp = request.headers.get('true-client-ip');
  if (trueClientIp?.trim()) return trueClientIp.trim();

  const realIp = request.headers.get('x-real-ip');
  if (realIp?.trim()) return realIp.trim();

  // 3. Direct NextRequest.ip (provided by Next.js / Edge Runtime)
  if ('ip' in request && typeof (request as { ip?: string }).ip === 'string') {
    const directIp = (request as { ip?: string }).ip?.trim();
    if (directIp) return directIp;
  }

  // 4. X-Forwarded-For
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    if (process.env.TRUSTED_PROXY_HOPS) {
      const proxyHops = Math.max(1, parseInt(process.env.TRUSTED_PROXY_HOPS, 10));
      const targetIdx = Math.max(0, hops.length - proxyHops);
      return hops[targetIdx] || hops[0] || '127.0.0.1';
    }
    return hops[0] || '127.0.0.1';
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

  // Use Upstash Redis pipeline for atomic INCR + EXPIRE if configured
  if (restUrl && restToken) {
    try {
      const pipelineRes = await fetch(`${restUrl}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${restToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', cacheKey],
          ['EXPIRE', cacheKey, windowSeconds],
        ]),
        signal: AbortSignal.timeout(2000),
      });

      if (pipelineRes.ok) {
        const data = (await pipelineRes.json()) as Array<{ result: number }>;
        const currentCount = Number(data[0]?.result ?? 1);

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
      // Fallback to in-memory store if Redis REST times out
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
