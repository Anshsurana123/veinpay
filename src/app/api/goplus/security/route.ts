import { NextRequest, NextResponse } from 'next/server';
import {
  checkGoPlusAddress,
  checkGoPlusToken,
  checkGoPlusApproval,
  checkGoPlusPhishing,
} from '@/lib/security/goplus';
import {
  buildRateLimitExceededResponse,
  checkRateLimit,
  getClientIp,
} from '@/lib/security/rate-limit';
import {
  goPlusSecurityQuerySchema,
  validateWithZod,
} from '@/lib/validation/schemas';

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('goplus-security', ip, {
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  const sp = request.nextUrl.searchParams;
  const rawParams = {
    type: sp.get('type') || 'address',
    address: sp.get('address') || undefined,
    url: sp.get('url') || undefined,
    chainId: sp.get('chainId') || sp.get('chain_id') || 1,
  };

  const validation = validateWithZod(goPlusSecurityQuerySchema, rawParams);
  if (!validation.success) {
    return NextResponse.json(validation, { status: 400 });
  }

  const { type, address, url, chainId } = validation.data;

  try {
    switch (type) {
      case 'address': {
        if (!address) {
          return NextResponse.json(
            { success: false, error: 'Address query parameter is required for address check.' },
            { status: 400 }
          );
        }
        const result = await checkGoPlusAddress(address, chainId);
        return NextResponse.json({ success: true, type, address, chainId, result });
      }
      case 'token': {
        if (!address) {
          return NextResponse.json(
            { success: false, error: 'Address (token contract) is required for token security check.' },
            { status: 400 }
          );
        }
        const result = await checkGoPlusToken(address, chainId);
        return NextResponse.json({ success: true, type, address, chainId, result });
      }
      case 'approval': {
        if (!address) {
          return NextResponse.json(
            { success: false, error: 'Address (spender contract) is required for approval security check.' },
            { status: 400 }
          );
        }
        const result = await checkGoPlusApproval(address, chainId);
        return NextResponse.json({ success: true, type, address, chainId, result });
      }
      case 'phishing': {
        if (!url) {
          return NextResponse.json(
            { success: false, error: 'URL parameter is required for phishing site check.' },
            { status: 400 }
          );
        }
        const result = await checkGoPlusPhishing(url);
        return NextResponse.json({ success: true, type, url, result });
      }
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid security check type.' },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'GoPlus security check failed',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('goplus-security', ip, {
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  try {
    const rawBody = (await request.json()) as Record<string, unknown>;
    const validation = validateWithZod(goPlusSecurityQuerySchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(validation, { status: 400 });
    }

    const { type, address, url, chainId } = validation.data;

    switch (type) {
      case 'address': {
        if (!address) {
          return NextResponse.json(
            { success: false, error: 'Address is required for address check.' },
            { status: 400 }
          );
        }
        const result = await checkGoPlusAddress(address, chainId);
        return NextResponse.json({ success: true, type, address, chainId, result });
      }
      case 'token': {
        if (!address) {
          return NextResponse.json(
            { success: false, error: 'Address (token contract) is required for token security check.' },
            { status: 400 }
          );
        }
        const result = await checkGoPlusToken(address, chainId);
        return NextResponse.json({ success: true, type, address, chainId, result });
      }
      case 'approval': {
        if (!address) {
          return NextResponse.json(
            { success: false, error: 'Address (spender contract) is required for approval security check.' },
            { status: 400 }
          );
        }
        const result = await checkGoPlusApproval(address, chainId);
        return NextResponse.json({ success: true, type, address, chainId, result });
      }
      case 'phishing': {
        if (!url) {
          return NextResponse.json(
            { success: false, error: 'URL is required for phishing site check.' },
            { status: 400 }
          );
        }
        const result = await checkGoPlusPhishing(url);
        return NextResponse.json({ success: true, type, url, result });
      }
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid security check type.' },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Invalid request payload',
      },
      { status: 400 }
    );
  }
}
