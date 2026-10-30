import { describe, it, expect, vi } from 'vitest';
import {
  TIGERGRAPH_MCP_TOOLS,
  executeTigerGraphMcpTool,
} from '@/lib/graph/tigergraph-mcp';
import { POST as postMcp } from '@/app/api/mcp/tigergraph/route';
import { tryExecuteLiveTigerGraphQuery } from '@/lib/graph/tigergraph-client';
import { NextRequest } from 'next/server';

describe('TigerGraph MCP Implementation Suite', () => {
  it('exposes standard TigerGraph MCP tool definitions', () => {
    const names = TIGERGRAPH_MCP_TOOLS.map((t) => t.name);
    expect(names).toContain('graph__run_query');
    expect(names).toContain('graph__get_schema');
    expect(names).toContain('graph__get_neighbors');
    expect(names).toContain('graph__breadth_first_search');
    expect(names).toContain('graph__get_node_data');
    expect(names).toContain('graph__get_nodes');
    expect(names).toContain('graph__degree');
    expect(names).toContain('graph__number_of_nodes');
    expect(names).toContain('graph__number_of_edges');
  });

  it('executes graph__get_schema returning VeilPayGraph schema', async () => {
    const res = await executeTigerGraphMcpTool('graph__get_schema', {
      graph_name: 'VeilPayGraph',
    });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.graph).toBe('VeilPayGraph');
    const vertexNames = payload.vertex_types.map((v: { name: string }) => v.name);
    expect(vertexNames).toContain('Wallet');
    expect(vertexNames).toContain('Merchant');
    expect(vertexNames).toContain('ThreatEntity');
    const edgeNames = payload.edge_types.map((e: { name: string }) => e.name);
    expect(edgeNames).toContain('TRANSFERRED_TO');
    expect(edgeNames).toContain('DUSTED');
  });

  it('executes graph__run_query for veilpay_firewall_check on clean wallet', async () => {
    const res = await executeTigerGraphMcpTool('graph__run_query', {
      graph_name: 'VeilPayGraph',
      query_name: 'veilpay_firewall_check',
      params: {
        target_wallet: '0x1111111111111111111111111111111111111111',
        merchant_wallet: '0x71C84102070853531b783c5D2D563456F9960244',
        max_hops: 3,
        sybil_threshold: 10,
      },
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.query).toBe('veilpay_firewall_check');
    expect(data.results[0].socketUnlocked).toBe(true);
    expect(data.results[0].verdict).toBe('VERIFIED_CLEAN');
  });

  it('executes graph__run_query for veilpay_firewall_check on drainer wallet', async () => {
    // 0x99B1c402881a77e3d90123456789aB00000FDead is seeded drainer target (Persona 2)
    const res = await executeTigerGraphMcpTool('graph__run_query', {
      graph_name: 'VeilPayGraph',
      query_name: 'veilpay_firewall_check',
      params: {
        target_wallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
        merchant_wallet: '0x71C84102070853531b783c5D2D563456F9960244',
        max_hops: 3,
        sybil_threshold: 10,
      },
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.results[0].socketUnlocked).toBe(false);
    expect(data.results[0].verdict).toBe('INTERCEPTED_TAINT');
    expect(data.results[0].taint_hits).toBeGreaterThan(0);
  });

  it('executes graph__get_neighbors to inspect inbound/outbound adjacency', async () => {
    const res = await executeTigerGraphMcpTool('graph__get_neighbors', {
      node_id: '0x99B1c402881a77e3d90123456789aB00000FDead',
      direction: 'both',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total_neighbors).toBeGreaterThan(0);
  });

  it('executes graph__breadth_first_search up to specified depth', async () => {
    const res = await executeTigerGraphMcpTool('graph__breadth_first_search', {
      source_node: '0x99B1c402881a77e3d90123456789aB00000FDead',
      max_depth: 3,
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total_nodes_visited).toBeGreaterThan(1);
    expect(data.levels[1].length).toBeGreaterThan(0);
  });

  it('executes graph__degree, graph__number_of_nodes, and graph__number_of_edges', async () => {
    const degRes = await executeTigerGraphMcpTool('graph__degree', {
      node_id: '0x99B1c402881a77e3d90123456789aB00000FDead',
    });
    expect(degRes.isError).toBeFalsy();
    const degData = JSON.parse(degRes.content[0].text);
    expect(degData.total_degree).toBeGreaterThan(0);

    const nodesRes = await executeTigerGraphMcpTool('graph__number_of_nodes');
    const nodesData = JSON.parse(nodesRes.content[0].text);
    expect(nodesData.number_of_nodes).toBeGreaterThan(10);

    const edgesRes = await executeTigerGraphMcpTool('graph__number_of_edges');
    const edgesData = JSON.parse(edgesRes.content[0].text);
    expect(edgesData.number_of_edges).toBeGreaterThan(10);
  });

  it('returns graceful error on unknown tool', async () => {
    const res = await executeTigerGraphMcpTool('graph__unknown_tool_xyz');
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unknown TigerGraph MCP tool");
  });

  it('handles JSON-RPC initialize method on /api/mcp/tigergraph', async () => {
    const req = new NextRequest('http://localhost:3000/api/mcp/tigergraph', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      }),
    });
    const res = await postMcp(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jsonrpc).toBe('2.0');
    expect(json.id).toBe('init-1');
    expect(json.result.serverInfo.name).toBe('tigergraph-mcp-veilpay');
    expect(json.result.capabilities.tools).toBeDefined();
  });

  it('tryExecuteLiveTigerGraphQuery maps live GSQL envelope verdict and metrics correctly', async () => {
    process.env.TIGERGRAPH_HOST = 'http://test-tigergraph-cluster.local:9000';
    process.env.TIGERGRAPH_TOKEN = 'test-token-xyz';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: { edition: 'enterprise', api: 'v2', schema: 1 },
        error: false,
        message: '',
        results: [
          {
            verdict: 'INTERCEPTED_TAINT',
            target_wallet: '0x1111111111111111111111111111111111111111',
            merchant_wallet: '0x71C84102070853531b783c5D2D563456F9960244',
            max_hops_queried: 3,
            min_taint_hop: 1,
            taint_hits: 2,
            sybil_cluster_size: 1,
            sybil_root_funders: [],
            cyclic_loop_detected: false,
            self_transfer_detected: false,
            dust_out_degree: 0,
            nodes_scanned: 15,
            edges_traversed: 22,
            '@@evidence_edges': [],
          },
        ],
      }),
    });

    const origFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      const res = await tryExecuteLiveTigerGraphQuery({
        targetWallet: '0x1111111111111111111111111111111111111111',
        merchantWallet: '0x71C84102070853531b783c5D2D563456F9960244',
        policy: {
          firewallEnabled: true,
          maxHops: 3,
          cleanLinkEnabled: true,
          unbundleEnabled: true,
          socketAutoBridgeEnabled: true,
          sybilBlockThreshold: 10,
        },
      });

      expect(res).not.toBeNull();
      expect(res?.verdict).toBe('INTERCEPTED_TAINT');
      expect(res?.taintHits).toBe(2);
      expect(res?.minTaintHop).toBe(1);
      expect(res?.nodesScanned).toBe(15);
      expect(res?.edgesTraversed).toBe(22);
      expect(res?.executionSource).toBe('TIGERGRAPH_RESTPP_LIVE');
      expect(res?.socketUnlocked).toBe(false);
    } finally {
      global.fetch = origFetch;
      delete process.env.TIGERGRAPH_HOST;
      delete process.env.TIGERGRAPH_TOKEN;
    }
  });
});
