import { describe, expect, it } from 'vitest';
import { checkIntegrationsHealth } from '@/lib/health';
import { GET } from '@/app/api/health/route';
import { NextRequest } from 'next/server';

describe('Issue 12: Real Health Diagnostics (GET /api/health)', () => {
  it('returns valid integration health with only booleans and short status strings', async () => {
    const health = await checkIntegrationsHealth(true); // skipPing in tests

    expect(typeof health.healthy).toBe('boolean');
    expect(typeof health.timestamp).toBe('string');

    const expectedIntegrations = [
      'socket',
      'tigergraph',
      'etherscan',
      'goplus',
      'gemini',
      'reown',
      'redis',
    ] as const;

    for (const name of expectedIntegrations) {
      const item = health.integrations[name];
      expect(item).toBeDefined();
      expect(typeof item.configured).toBe('boolean');
      expect(['ok', 'not_configured', 'degraded']).toContain(item.status);
      expect(typeof item.message).toBe('string');
    }
  });

  it('guarantees no secrets or sensitive keys are leaked in health messages or fields', async () => {
    const testSecret = 'sk_live_super_secret_token_12345';
    process.env.ETHERSCAN_API_KEY = testSecret;
    process.env.GEMINI_API_KEY = testSecret;
    process.env.UPSTASH_REDIS_REST_TOKEN = testSecret;

    const health = await checkIntegrationsHealth(true);
    const serialized = JSON.stringify(health);

    expect(serialized).not.toContain(testSecret);

    delete process.env.ETHERSCAN_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('correctly marks unconfigured integrations as not_configured', async () => {
    delete process.env.ETHERSCAN_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.TIGERGRAPH_HOST;
    delete process.env.UPSTASH_REDIS_REST_URL;

    const health = await checkIntegrationsHealth(true, Date.now() + 100000);

    expect(health.integrations.etherscan.status).toBe('not_configured');
    expect(health.integrations.gemini.status).toBe('not_configured');
    expect(health.integrations.tigergraph.status).toBe('not_configured');
    expect(health.integrations.redis.status).toBe('not_configured');
  });

  it('HTTP GET /api/health route handler returns HTTP 200/503 with Cache-Control headers', async () => {
    const req = new NextRequest('http://localhost:3000/api/health?ping=false');
    const res = await GET(req);

    expect([200, 503]).toContain(res.status);
    expect(res.headers.get('Cache-Control')).toContain('no-store');

    const json = await res.json();
    expect(json.integrations).toBeDefined();
    expect(json.integrations.socket.status).toBeDefined();
  });
});
