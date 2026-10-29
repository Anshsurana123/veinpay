import { describe, it, expect } from 'vitest';
import {
  TIGERGRAPH_MCP_TOOLS,
  executeTigerGraphMcpTool,
} from '@/lib/graph/tigergraph-mcp';

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
});
