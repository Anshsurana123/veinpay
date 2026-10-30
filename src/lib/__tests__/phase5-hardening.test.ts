import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import { maxDuration as scanMaxDuration, POST as postScan } from '@/app/api/firewall/scan/route';
import { maxDuration as socketMaxDuration, GET as getSocketQuote } from '@/app/api/socket/quote/route';
import { maxDuration as cctpMaxDuration, GET as getCctpQuote } from '@/app/api/cctp/quote/route';
import { GET as getJob } from '@/app/api/firewall/scan/jobs/[id]/route';
import { getClientIp } from '@/lib/security/rate-limit';
import { createPaymentLinkPayload, buildPaymentLinkTypedData } from '@/lib/links/eip712';
import { encodeSignedLinkPayloadToBase64Url } from '@/lib/links/canonical';
import { signScanAttestation } from '@/lib/security/attestation';
import nextConfig from '../../../next.config';

const TEST_ACCOUNT = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
);

async function createSignedLink(amount = '10.00', openAmount = false) {
  const payload = createPaymentLinkPayload({
    handle: 'hardening-test',
    amount,
    openAmount,
    asset: 'USDC',
    destinationChainId: 84532,
    settlementMode: 'EVM_SOCKET',
    vaultAddress: TEST_ACCOUNT.address,
    policy: {
      firewallEnabled: true,
      maxHops: 3,
      cleanLinkEnabled: true,
      unbundleEnabled: true,
      socketAutoBridgeEnabled: true,
      sybilBlockThreshold: 10,
    },
    signer: TEST_ACCOUNT.address,
  });
  const sig = await TEST_ACCOUNT.signTypedData(buildPaymentLinkTypedData(payload));
  const c = encodeSignedLinkPayloadToBase64Url(payload);
  return { payload, sig, c };
}

describe('Phase 5: Hardening & Protocol Alignment Regression Suite', () => {
  describe('P1-6: Serverless maxDuration and Async Job Model', () => {
    it('exports maxDuration = 30 across long-running route handlers', () => {
      expect(scanMaxDuration).toBe(30);
      expect(socketMaxDuration).toBe(30);
      expect(cctpMaxDuration).toBe(30);
    });

    it('returns 202 Accepted with jobId and statusUrl when async=true is passed', async () => {
      const link = await createSignedLink();

      const req = new NextRequest('http://localhost:3000/api/firewall/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetWallet: '0x1111111111111111111111111111111111111111',
          chainId: 84532,
          linkId: link.payload.linkId,
          c: link.c,
          sig: link.sig,
          async: true,
        }),
      });

      const res = await postScan(req);
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.jobId).toBeDefined();
      expect(json.status).toBe('PENDING');
      expect(json.statusUrl).toContain('/api/firewall/scan/jobs/');

      // Poll the job status route
      const jobReq = new NextRequest(`http://localhost:3000${json.statusUrl}`);
      const jobRes = await getJob(jobReq, { params: Promise.resolve({ id: json.jobId }) });
      expect(jobRes.status).toBe(200);
      const jobJson = await jobRes.json();
      expect(['PENDING', 'RUNNING', 'COMPLETED']).toContain(jobJson.status);
    });
  });

  describe('P1-7: Rate Limiter IP Extraction & Spoofing Guard', () => {
    it('respects TRUSTED_IP_HEADER when configured', () => {
      const origHeader = process.env.TRUSTED_IP_HEADER;
      process.env.TRUSTED_IP_HEADER = 'x-custom-real-ip';

      try {
        const req = new Request('http://localhost', {
          headers: {
            'x-forwarded-for': '1.1.1.1, 2.2.2.2',
            'x-custom-real-ip': '99.88.77.66',
          },
        });
        expect(getClientIp(req)).toBe('99.88.77.66');
      } finally {
        if (origHeader !== undefined) {
          process.env.TRUSTED_IP_HEADER = origHeader;
        } else {
          delete process.env.TRUSTED_IP_HEADER;
        }
      }
    });

    it('respects TRUSTED_PROXY_HOPS for x-forwarded-for', () => {
      const origHops = process.env.TRUSTED_PROXY_HOPS;
      process.env.TRUSTED_PROXY_HOPS = '2';

      try {
        const req = new Request('http://localhost', {
          headers: {
            // hops: [spoofed_client, real_client, proxy_1, proxy_2]
            'x-forwarded-for': '10.0.0.1, 198.51.100.5, 172.16.0.1, 172.16.0.2',
          },
        });
        // 4 hops total, 2 from the right: index 4 - 2 = 2 => '172.16.0.1'
        expect(getClientIp(req)).toBe('172.16.0.1');
      } finally {
        if (origHops !== undefined) {
          process.env.TRUSTED_PROXY_HOPS = origHops;
        } else {
          delete process.env.TRUSTED_PROXY_HOPS;
        }
      }
    });
  });

  describe('P1-8: Invoice Amount Enforcement on Payment Links', () => {
    it('rejects quote when requested inputAmount is below signed link invoice amount', async () => {
      const link = await createSignedLink('10.00', false);
      const payer = '0x1111111111111111111111111111111111111111';

      const attestation = signScanAttestation({
        payer,
        linkId: link.payload.linkId,
        linkSigner: TEST_ACCOUNT.address,
        policy: link.payload.policy,
        verdict: 'VERIFIED_CLEAN',
        socketUnlocked: true,
        proofOfControl: true,
      });

      // Payer requests 10,000 atomic units (0.01 USDC) on a 10.00 USDC invoice
      const url = `http://localhost:3000/api/socket/quote?originChainId=84532&destinationChainId=84532&inputToken=USDC&outputToken=USDC&inputAmount=10000&userAddress=${payer}&linkId=${link.payload.linkId}&c=${encodeURIComponent(link.c)}&sig=${encodeURIComponent(link.sig)}&scanAttestation=${encodeURIComponent(attestation)}`;
      const req = new NextRequest(url);
      const res = await getSocketQuote(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('AMOUNT_BELOW_INVOICE');
    });

    it('rejects CCTP quote when requested amount is below signed invoice amount', async () => {
      const link = await createSignedLink('50.00', false);
      const payer = '0x1111111111111111111111111111111111111111';

      const attestation = signScanAttestation({
        payer,
        linkId: link.payload.linkId,
        linkSigner: TEST_ACCOUNT.address,
        policy: link.payload.policy,
        verdict: 'VERIFIED_CLEAN',
        socketUnlocked: true,
        proofOfControl: true,
      });

      // 1,000,000 atomic units (1.00 USDC) on a 50.00 USDC invoice
      const url = `http://localhost:3000/api/cctp/quote?originChainId=84532&destinationChainId=421614&inputToken=USDC&outputToken=USDC&inputAmount=1000000&userAddress=${payer}&linkId=${link.payload.linkId}&c=${encodeURIComponent(link.c)}&sig=${encodeURIComponent(link.sig)}&scanAttestation=${encodeURIComponent(attestation)}&useForwardingService=false`;
      const req = new NextRequest(url);
      const res = await getCctpQuote(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('AMOUNT_BELOW_INVOICE');
    });
  });

  describe('P1-10: Security Headers in next.config.ts', () => {
    it('defines CSP, HSTS, X-Content-Type-Options, and X-Frame-Options in next.config.ts', async () => {
      expect(typeof nextConfig.headers).toBe('function');
      const headerConfigs = await nextConfig.headers!();
      expect(headerConfigs.length).toBeGreaterThan(0);

      const allHeaders = headerConfigs[0].headers;
      const headerKeys = allHeaders.map((h: { key: string }) => h.key);

      expect(headerKeys).toContain('Content-Security-Policy');
      expect(headerKeys).toContain('Strict-Transport-Security');
      expect(headerKeys).toContain('X-Content-Type-Options');
      expect(headerKeys).toContain('X-Frame-Options');
      expect(headerKeys).toContain('Referrer-Policy');

      const hsts = allHeaders.find((h: { key: string }) => h.key === 'Strict-Transport-Security');
      expect(hsts?.value).toContain('max-age=63072000');

      const frameOptions = allHeaders.find((h: { key: string }) => h.key === 'X-Frame-Options');
      expect(frameOptions?.value).toBe('DENY');
    });
  });
});
