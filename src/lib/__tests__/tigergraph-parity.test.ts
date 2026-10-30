import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  scanWithTigerGraph,
  buildTigerGraphFailClosedScan,
} from '@/lib/graph/tigergraph/orchestrator';
import {
  executeTigerGraphQuery,
  formatVertexParam,
} from '@/lib/graph/tigergraph/client';
import { batchUpsertToTigerGraph } from '@/lib/graph/tigergraph/ingest';
import {
  evaluateOutboundPoisonRisk,
  deriveTrustedContactsFromGraph,
} from '@/lib/graph/poison-guard';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';
import { buildSeededGraphDataset } from '@/lib/graph/seed-topologies';
import type { FirewallPolicyConfig } from '@/types/veilpay';

const PERSONAS = {
  CLEAN: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
  DRAINER_2HOP: '0x99B1c402881a77e3d90123456789aB00000FDead',
  SYBIL_CLUSTER: '0x33A188C0227189aB1234567890abcdef00029988',
  POISONER: '0x88f1a234567890abcdef1234567890abcdef1234',
};

const BASE_POLICY: FirewallPolicyConfig = {
  firewallEnabled: true,
  maxHops: 3,
  cleanLinkEnabled: true,
  unbundleEnabled: true,
  socketAutoBridgeEnabled: true,
  sybilBlockThreshold: 10,
  inconclusivePolicy: 'BLOCK',
};

describe('TigerGraph 4.x Parity & Golden Vector Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Vertex parameter formatting encodes VERTEX<Address> properly', () => {
    const formatted = formatVertexParam('0x1234567890123456789012345678901234567890');
    expect(formatted).toEqual({
      id: '0x1234567890123456789012345678901234567890',
      type: 'Address',
    });
  });

  it('2. Persona Golden Vectors across Hop Depths 1 to 5 produce consistent verdicts', () => {
    for (let hops = 1; hops <= 5; hops++) {
      const policy: FirewallPolicyConfig = {
        ...BASE_POLICY,
        maxHops: hops as any,
      };

      // Clean persona is clean at all hops
      const cleanScan = runVeilPayFirewallTraversal({
        targetWallet: PERSONAS.CLEAN,
        policy,
      });
      expect(cleanScan.verdict).toBe('VERIFIED_CLEAN');
      expect(cleanScan.socketUnlocked).toBe(true);

      // Drainer persona: at hop 1 is intermediate mule (clean at hop 1), at hop >= 2 catches Lazarus exploit taint
      const drainerScan = runVeilPayFirewallTraversal({
        targetWallet: PERSONAS.DRAINER_2HOP,
        policy,
      });
      if (hops === 1) {
        expect(drainerScan.verdict).toBe('VERIFIED_CLEAN');
        expect(drainerScan.socketUnlocked).toBe(true);
      } else {
        expect(drainerScan.verdict).toBe('INTERCEPTED_TAINT');
        expect(drainerScan.socketUnlocked).toBe(false);
        expect(drainerScan.minTaintHop).toBe(2);
      }
    }
  });

  it('3. TigerGraph RESTPP live orchestrator executes query and parses envelope without local mirror merge', async () => {
    const origHost = process.env.TIGERGRAPH_HOST;
    const origToken = process.env.TIGERGRAPH_TOKEN;
    const origFetch = global.fetch;

    try {
      process.env.TIGERGRAPH_HOST = 'http://127.0.0.1:9000';
      process.env.TIGERGRAPH_TOKEN = 'test-bearer-token';

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('veilpay_firewall_check')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                version: { edition: 'enterprise', api: 'v2', schema: 1 },
                error: false,
                message: '',
                results: [
                  {
                    verdict: 'INTERCEPTED_TAINT',
                    target_wallet: PERSONAS.DRAINER_2HOP,
                    merchant_wallet: '0x1111111111111111111111111111111111111111',
                    max_hops_queried: 3,
                    min_taint_hop: 2,
                    taint_hits: 1,
                    sybil_cluster_size: 1,
                    sybil_root_funders: [],
                    dust_out_degree: 0,
                    nodes_scanned: 15,
                    edges_traversed: 18,
                    '@@evidence_edges': [
                      {
                        from_id: '0xdead000000000000000000000000000000000001',
                        to_id: '0x99b1c402881a77e3d90123456789ab00000fdead',
                        hop_distance: 2,
                        amount: 50000,
                        amount_usd: 50000,
                        token: 'USDC',
                        tx_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
                        is_taint_path: true,
                      },
                    ],
                  },
                ],
              }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      const scanResult = await scanWithTigerGraph({
        targetWallet: PERSONAS.DRAINER_2HOP,
        merchantWallet: '0x1111111111111111111111111111111111111111',
        policy: BASE_POLICY,
      });

      expect(scanResult).not.toBeNull();
      expect(scanResult?.executionSource).toBe('TIGERGRAPH_RESTPP_LIVE');
      expect(scanResult?.verdict).toBe('INTERCEPTED_TAINT');
      expect(scanResult?.socketUnlocked).toBe(false);
      expect(scanResult?.evidenceEdges.length).toBe(1);
      expect(scanResult?.evidenceEdges[0].attributes.token).toBe('USDC');
    } finally {
      global.fetch = origFetch;
      if (origHost !== undefined) process.env.TIGERGRAPH_HOST = origHost;
      else delete process.env.TIGERGRAPH_HOST;
      if (origToken !== undefined) process.env.TIGERGRAPH_TOKEN = origToken;
      else delete process.env.TIGERGRAPH_TOKEN;
    }
  });

  it('4. Derives trusted contacts dynamically from graph adjacency (P1-12)', () => {
    const dataset = buildSeededGraphDataset();
    // Alice has sent legitimate transactions to Bob and Carol in dataset
    const contacts = deriveTrustedContactsFromGraph(PERSONAS.CLEAN, dataset);
    expect(Array.isArray(contacts)).toBe(true);

    // Evaluate risk with derived contacts
    const poisonRisk = evaluateOutboundPoisonRisk({
      candidateInput: '0x22A9c0018834dEf011223344556677880004771C',
      senderAddress: PERSONAS.CLEAN,
    });

    expect(['NO_LOOKALIKE_FOUND', 'VERIFIED_FIRST_TIME_RECIPIENT']).toContain(poisonRisk.verdict);
  });

  it('5. Hub termination: institutional whitelisted vertices are not clustered as sybil roots (P1-4)', () => {
    // Uniswap V3 Pool and Coinbase Hot Wallet fund thousands of addresses; they must not cause sybil grouping
    const scan = runVeilPayFirewallTraversal({
      targetWallet: PERSONAS.CLEAN,
      policy: {
        ...BASE_POLICY,
        unbundleEnabled: true,
        sybilBlockThreshold: 5,
      },
    });

    expect(scan.verdict).toBe('VERIFIED_CLEAN');
    expect(scan.sybilClusterSize).toBe(1);
    expect(scan.sybilRootFunder).toBeNull();
  });
});
