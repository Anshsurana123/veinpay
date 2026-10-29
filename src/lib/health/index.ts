export type IntegrationStatus = 'ok' | 'not_configured' | 'degraded';

export interface IntegrationHealth {
  configured: boolean;
  status: IntegrationStatus;
  message: string;
}

export interface HealthCheckResponse {
  healthy: boolean;
  timestamp: string;
  integrations: {
    socket: IntegrationHealth;
    tigergraph: IntegrationHealth;
    etherscan: IntegrationHealth;
    goplus: IntegrationHealth;
    gemini: IntegrationHealth;
    reown: IntegrationHealth;
    redis: IntegrationHealth;
  };
}

let cachedHealth: { data: HealthCheckResponse; expiresAt: number } | null = null;

export async function checkIntegrationsHealth(
  skipPing = false,
  now = Date.now()
): Promise<HealthCheckResponse> {
  if (!skipPing && cachedHealth && now < cachedHealth.expiresAt) {
    return cachedHealth.data;
  }

  // 1. Socket V3
  let socketHealth: IntegrationHealth = {
    configured: true,
    status: 'ok',
    message: 'Socket Swap V3 ready (public backend + deterministic fallback)',
  };
  if (!skipPing) {
    try {
      const res = await fetch(
        'https://public-backend.socket.tech/v3/swap/quote?userOps=tx&fromChainId=42161&toChainId=8453&fromTokenAddress=0xaf88d065e77c8cC2239327C5EDb3A432268e5831&toTokenAddress=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&fromAmount=1000000&userAddress=0x4F2a9c117034e8B1200499A1c3f88200000188E1&recipient=0x4F2a9c117034e8B1200499A1c3f88200000188E1',
        { signal: AbortSignal.timeout(1500) }
      );
      if (!res.ok) {
        socketHealth = {
          configured: true,
          status: 'degraded',
          message: `Public Socket API returned HTTP ${res.status}; fallback active`,
        };
      }
    } catch {
      socketHealth = {
        configured: true,
        status: 'degraded',
        message: 'Socket API ping timed out; deterministic fallback active',
      };
    }
  }

  // 2. TigerGraph 4.x RESTPP
  const tgHost = process.env.TIGERGRAPH_HOST?.trim();
  const tgToken = process.env.TIGERGRAPH_TOKEN?.trim() || process.env.TIGERGRAPH_SECRET?.trim();
  let tgHealth: IntegrationHealth = {
    configured: Boolean(tgHost && tgToken),
    status: tgHost && tgToken ? 'ok' : 'not_configured',
    message:
      tgHost && tgToken
        ? 'TigerGraph 4.x RESTPP configured with in-process GSQL engine fallback'
        : 'In-process GSQL engine active (RESTPP host/token not configured)',
  };
  if (tgHost && tgToken && !skipPing) {
    try {
      const pingUrl = `${tgHost.replace(/\/+$/, '')}:14240/restpp/echo`;
      const res = await fetch(pingUrl, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok && res.status !== 401) {
        tgHealth.status = 'degraded';
        tgHealth.message = `TigerGraph echo returned HTTP ${res.status}`;
      }
    } catch {
      tgHealth.status = 'degraded';
      tgHealth.message = 'TigerGraph RESTPP host unreachable; in-process engine active';
    }
  }

  // 3. Etherscan V2
  const etherscanKey = process.env.ETHERSCAN_API_KEY?.trim();
  let etherscanHealth: IntegrationHealth = {
    configured: Boolean(etherscanKey),
    status: etherscanKey ? 'ok' : 'not_configured',
    message: etherscanKey
      ? 'Etherscan API V2 configured for live multi-hop wallet crawling'
      : 'Etherscan API key not configured (unseeded wallets return INCONCLUSIVE)',
  };
  if (etherscanKey && !skipPing) {
    try {
      const res = await fetch(
        `https://api.etherscan.io/v2/api?chainid=1&module=proxy&action=eth_blockNumber&apikey=${encodeURIComponent(
          etherscanKey
        )}`,
        { signal: AbortSignal.timeout(1500) }
      );
      if (!res.ok) {
        etherscanHealth.status = 'degraded';
        etherscanHealth.message = `Etherscan ping returned HTTP ${res.status}`;
      }
    } catch {
      etherscanHealth.status = 'degraded';
      etherscanHealth.message = 'Etherscan API ping timed out';
    }
  }

  // 4. GoPlus Address Security
  let goplusHealth: IntegrationHealth = {
    configured: true,
    status: 'ok',
    message: 'GoPlus Address Security API active',
  };
  if (!skipPing) {
    try {
      const res = await fetch(
        'https://api.gopluslabs.io/api/v1/supported_chains',
        { signal: AbortSignal.timeout(1500) }
      );
      if (!res.ok) {
        goplusHealth.status = 'degraded';
        goplusHealth.message = `GoPlus API returned HTTP ${res.status}`;
      }
    } catch {
      goplusHealth.status = 'degraded';
      goplusHealth.message = 'GoPlus API ping timed out; offline snapshot active';
    }
  }

  // 5. Gemini Narration
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiEnabled = process.env.ENABLE_GEMINI_NARRATION === 'true';
  const geminiHealth: IntegrationHealth = {
    configured: Boolean(geminiKey && geminiEnabled),
    status:
      geminiKey && geminiEnabled
        ? 'ok'
        : !geminiKey
        ? 'not_configured'
        : 'not_configured',
    message:
      geminiKey && geminiEnabled
        ? 'Gemini API configured and enabled for structured compliance narration'
        : !geminiKey
        ? 'GEMINI_API_KEY not configured (pure deterministic narration active)'
        : 'ENABLE_GEMINI_NARRATION is false (narration credit lock active)',
  };

  // 6. Reown AppKit
  const reownProjectId = process.env.NEXT_PUBLIC_PROJECT_ID?.trim();
  const reownHealth: IntegrationHealth = {
    configured: Boolean(reownProjectId),
    status: reownProjectId ? 'ok' : 'not_configured',
    message: reownProjectId
      ? 'Reown AppKit project ID configured'
      : 'NEXT_PUBLIC_PROJECT_ID missing (wallet connection disabled)',
  };

  // 7. Upstash Redis
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  let redisHealth: IntegrationHealth = {
    configured: Boolean(redisUrl && redisToken),
    status: redisUrl && redisToken ? 'ok' : 'not_configured',
    message:
      redisUrl && redisToken
        ? 'Upstash Redis REST configured for persistent events & distributed rate limiting'
        : 'In-memory non-persistent event store and rate limiter active',
  };
  if (redisUrl && redisToken && !skipPing) {
    try {
      const res = await fetch(redisUrl.replace(/\/+$/, ''), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redisToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['PING']),
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) {
        redisHealth.status = 'degraded';
        redisHealth.message = `Upstash Redis returned HTTP ${res.status}`;
      }
    } catch {
      redisHealth.status = 'degraded';
      redisHealth.message = 'Upstash Redis ping timed out; in-memory store active';
    }
  }

  const allStatuses = [
    socketHealth.status,
    tigergraphHealthStatus(tgHealth),
    etherscanHealth.status,
    goplusHealth.status,
    reownHealth.status,
  ];

  const overallHealthy = !allStatuses.includes('degraded');

  const result: HealthCheckResponse = {
    healthy: overallHealthy,
    timestamp: new Date().toISOString(),
    integrations: {
      socket: socketHealth,
      tigergraph: tgHealth,
      etherscan: etherscanHealth,
      goplus: goplusHealth,
      gemini: geminiHealth,
      reown: reownHealth,
      redis: redisHealth,
    },
  };

  cachedHealth = {
    data: result,
    expiresAt: now + 10_000, // 10s health cache
  };

  return result;
}

function tigergraphHealthStatus(h: IntegrationHealth): IntegrationStatus {
  // If not configured, in-process engine is 100% functional, so it's not degraded
  return h.status === 'degraded' ? 'degraded' : 'ok';
}
