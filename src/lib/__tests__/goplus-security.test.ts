import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkGoPlusAddress,
  checkGoPlusToken,
  checkGoPlusApproval,
  checkGoPlusPhishing,
  getGoPlusHeaders,
} from '@/lib/security/goplus';

describe('GoPlus Security Integration Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GOPLUS_API_KEY = 'uavkEBgeNgPU68a3dXMXEb6JBpJkFgJK';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('generates authenticated headers with X-API-KEY and api-key', () => {
    const headers = getGoPlusHeaders();
    expect(headers['X-API-KEY']).toBe('uavkEBgeNgPU68a3dXMXEb6JBpJkFgJK');
    expect(headers['api-key']).toBe('uavkEBgeNgPU68a3dXMXEb6JBpJkFgJK');
    expect(headers['accept']).toBe('application/json');
  });

  it('omits API key headers when GOPLUS_API_KEY is unset', () => {
    delete process.env.GOPLUS_API_KEY;
    const headers = getGoPlusHeaders();
    expect(headers['X-API-KEY']).toBeUndefined();
    expect(headers['api-key']).toBeUndefined();
    expect(headers['accept']).toBe('application/json');
  });

  it('identifies sanctioned mixer and money laundering addresses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 1,
        message: 'ok',
        result: {
          sanctioned: '1',
          mixer: '1',
          money_laundering: '0',
          data_source: 'OFAC SDN',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const verdict = await checkGoPlusAddress('0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b', 1);
    expect(verdict.isThreat).toBe(true);
    expect(verdict.riskCategory).toBe('SANCTIONED_MIXER');
    expect(verdict.details.sanctioned).toBe(true);
    expect(verdict.details.mixer).toBe(true);
    expect(verdict.source).toContain('OFAC SDN');
  });

  it('identifies drainer and phishing addresses from malicious contracts created and stealing attack', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 1,
        message: 'ok',
        result: {
          stealing_attack: '1',
          phishing_activities: '1',
          number_of_malicious_contracts_created: '3',
          data_source: 'ScamSniffer',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const verdict = await checkGoPlusAddress('0x7777777777777777777777777777777777777777', 1);
    expect(verdict.isThreat).toBe(true);
    expect(verdict.riskCategory).toBe('APPROVAL_DRAINER');
    expect(verdict.details.drainerOrPhishing).toBe(true);
    expect(verdict.source).toContain('ScamSniffer');
  });

  it('identifies exploit contracts and gas abuse attacks', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 1,
        message: 'ok',
        result: {
          gas_abuse: '1',
          honeypot_related_address: '1',
          financial_crime: '1',
          data_source: 'BlockSec',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const verdict = await checkGoPlusAddress('0x8888888888888888888888888888888888888888', 1);
    expect(verdict.isThreat).toBe(true);
    expect(verdict.riskCategory).toBe('EXPLOIT_CONTRACT');
    expect(verdict.details.exploitOrCybercrime).toBe(true);
    expect(verdict.details.gasAbuse).toBe(true);
    expect(verdict.details.honeypotCreator).toBe(true);
  });

  it('verifies clean addresses without false positives', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 1,
        message: 'ok',
        result: {
          sanctioned: '0',
          mixer: '0',
          money_laundering: '0',
          stealing_attack: '0',
          phishing_activities: '0',
          cybercrime: '0',
          financial_crime: '0',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const verdict = await checkGoPlusAddress('0x1111111111111111111111111111111111111111', 1);
    expect(verdict.isThreat).toBe(false);
    expect(verdict.riskCategory).toBe('CLEAN');
    expect(verdict.details.sanctioned).toBe(false);
  });

  it('evaluates ERC-20 token security flags and honeypot risks', async () => {
    const tokenAddr = '0xbadbadbadbadbadbadbadbadbadbadbadbadbadb';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 1,
        result: {
          [tokenAddr]: {
            is_honeypot: '1',
            buy_tax: '0.15',
            sell_tax: '0.99',
            cannot_buy: '0',
            is_open_source: '0',
            trust_list: '0',
            token_name: 'ScamCoin',
            token_symbol: 'SCAM',
          },
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await checkGoPlusToken(tokenAddr, 1);
    expect(result.isHoneypot).toBe(true);
    expect(result.buyTaxPercent).toBe(15);
    expect(result.sellTaxPercent).toBe(99);
    expect(result.isSafeToTrade).toBe(false);
    expect(result.riskReasons.length).toBeGreaterThan(0);
  });

  it('evaluates approval spender security and doubt lists', async () => {
    const routerAddr = '0x1111111254fb6c44bac0bed2854e76f90643097d';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 1,
        result: {
          contract_name: 'AggregationRouterV4',
          tag: '1inch',
          is_contract: 1,
          trust_list: 1,
          doubt_list: 0,
          malicious_behavior: [],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await checkGoPlusApproval(routerAddr, 1);
    expect(result.isContract).toBe(true);
    expect(result.trustList).toBe(true);
    expect(result.isSafeSpender).toBe(true);
  });

  it('detects phishing site URLs', async () => {
    const phishingUrl = 'https://fake-bungee-drainer.xyz';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 1,
        result: {
          phishing_site: 1,
          website_contract_security: [],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await checkGoPlusPhishing(phishingUrl);
    expect(result.isPhishing).toBe(true);
  });
});
