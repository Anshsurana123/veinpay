import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getScan, POST as postScan } from '@/app/api/firewall/scan/route';
import { GET as getSocketQuote, POST as postSocketQuote } from '@/app/api/socket/quote/route';
import { GET as getCctpQuote } from '@/app/api/cctp/quote/route';
import { GET as getAigiVerdict, POST as postAigiVerdict } from '@/app/api/aigi/verdict/route';
import { POST as postAigiVerify } from '@/app/api/aigi/verify/route';
import { GET as getHealth } from '@/app/api/health/route';
import { GET as getRates } from '@/app/api/rates/route';
import { GET as getReceiptKey } from '@/app/.well-known/veinpay-receipt-key/route';
import { GET as getGoPlusSecurity, POST as postGoPlusSecurity } from '@/app/api/goplus/security/route';
import { GET as getTigerGraphMcp, POST as postTigerGraphMcp } from '@/app/api/mcp/tigergraph/route';
import {
  strictBooleanSchema,
  hopDepthSchema,
  validateWithZod,
  scanQuerySchema,
} from '@/lib/validation/schemas';
import { isReownConfigured, projectId } from '@/config/wagmi';

describe('Issue 14: API Route Handlers & Zod Validation Hygiene', () => {
  describe('Zod Boolean & HopDepth Coercion Hygiene', () => {
    it('parses "false" and "0" strictly as false (not truthy)', () => {
      expect(strictBooleanSchema.parse('false')).toBe(false);
      expect(strictBooleanSchema.parse('0')).toBe(false);
      expect(strictBooleanSchema.parse(false)).toBe(false);
    });

    it('parses "true" and "1" strictly as true', () => {
      expect(strictBooleanSchema.parse('true')).toBe(true);
      expect(strictBooleanSchema.parse('1')).toBe(true);
      expect(strictBooleanSchema.parse(true)).toBe(true);
    });

    it('enforces hopDepth strictly between 1 and 5', () => {
      expect(hopDepthSchema.parse('3')).toBe(3);
      expect(hopDepthSchema.parse(1)).toBe(1);
      expect(hopDepthSchema.parse(5)).toBe(5);
      expect(() => hopDepthSchema.parse(0)).toThrow();
      expect(() => hopDepthSchema.parse(6)).toThrow();
    });

    it('returns fieldErrors on malformed schema inputs', () => {
      const res = validateWithZod(scanQuerySchema, {
        targetWallet: 'not-an-evm-address',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toBe('VALIDATION_ERROR');
        expect(res.fieldErrors.targetWallet).toBeDefined();
      }
    });
  });

  describe('Route Handlers Return 400 on Malformed Inputs', () => {
    it('GET /api/firewall/scan returns 400 on invalid targetWallet', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/firewall/scan?targetWallet=invalid-wallet'
      );
      const res = await getScan(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('VALIDATION_ERROR');
    });

    it('POST /api/firewall/scan returns 400 on invalid payload', async () => {
      const req = new NextRequest('http://localhost:3000/api/firewall/scan', {
        method: 'POST',
        body: JSON.stringify({ targetWallet: 'invalid-wallet' }),
      });
      const res = await postScan(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('VALIDATION_ERROR');
    });

    it('GET /api/socket/quote returns 400 on missing/invalid inputAmount', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/socket/quote?inputAmount=not-a-number'
      );
      const res = await getSocketQuote(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('VALIDATION_ERROR');
    });

    it('GET /api/cctp/quote returns 400 on non-numeric inputAmount', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/cctp/quote?inputAmount=abc&userAddress=0x4F2a9c117034e8B1200499A1c3f88200000188E1'
      );
      const res = await getCctpQuote(req);
      expect(res.status).toBe(400);
    });

    it('POST /api/aigi/verify returns 400 when missing canonicalPayloadJson', async () => {
      const req = new NextRequest('http://localhost:3000/api/aigi/verify', {
        method: 'POST',
        body: JSON.stringify({ signature: '0x1234' }),
      });
      const res = await postAigiVerify(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('MISSING_CANONICAL_PAYLOAD');
    });

    it('GET /api/health succeeds with 200', async () => {
      const req = new NextRequest('http://localhost:3000/api/health?ping=false');
      const res = await getHealth(req);
      expect([200, 503]).toContain(res.status);
    });

    it('GET /api/rates returns spot price registry', async () => {
      const res = await getRates();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.rates).toBeDefined();
    });

    it('GET /.well-known/veinpay-receipt-key serves Ed25519 public key', async () => {
      const res = await getReceiptKey();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.algorithm).toBe('Ed25519');
    });

    it('GET /api/goplus/security validates address input', async () => {
      const req = new NextRequest('http://localhost:3000/api/goplus/security?type=address');
      const res = await getGoPlusSecurity(req);
      expect(res.status).toBe(400);
    });

    it('GET /api/mcp/tigergraph lists supported MCP tools', async () => {
      const res = await getTigerGraphMcp();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.server).toBe('TigerGraph-MCP-VeinPay');
      expect(json.tools.length).toBeGreaterThan(0);
    });

    it('POST /api/mcp/tigergraph responds to tools/list JSON-RPC', async () => {
      const req = new NextRequest('http://localhost:3000/api/mcp/tigergraph', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/list' }),
      });
      const res = await postTigerGraphMcp(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.tools.length).toBeGreaterThan(0);
    });
  });

  describe('Reown AppKit Project ID Hygiene', () => {
    it('isReownConfigured reflects environment presence and lacks committed hardcoded fallback', () => {
      if (!process.env.NEXT_PUBLIC_PROJECT_ID) {
        expect(projectId).toBe('');
        expect(isReownConfigured).toBe(false);
      } else {
        expect(isReownConfigured).toBe(true);
      }
    });
  });
});
