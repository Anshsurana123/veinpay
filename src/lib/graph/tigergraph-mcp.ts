/**
 * TigerGraph MCP (Model Context Protocol) Integration for VeinPay
 * Reference: https://github.com/TigerGraph-DevLabs/tigergraph-mcp
 *
 * Implements TigerGraph MCP Tool specifications:
 * - graph__run_query (executes GSQL queries including veinpay_firewall_check)
 * - graph__get_schema (retrieves VeinPayGraph schema)
 * - graph__get_neighbors (traverses 1-hop inbound/outbound relationships)
 * - graph__breadth_first_search (multi-hop cycle-safe directed BFS)
 * - graph__get_node_data (inspects vertex attributes)
 * - graph__get_nodes (lists vertices by type)
 * - graph__degree (computes in/out/total degree)
 * - graph__number_of_nodes (counts vertices)
 * - graph__number_of_edges (counts edges)
 */

import { buildSeededGraphDataset, type SeedGraphDataset } from '@/lib/graph/seed-topologies';
import { runVeinPayFirewallTraversal } from '@/lib/graph/engine';
import { tryExecuteLiveTigerGraphQuery } from '@/lib/graph/tigergraph-client';
import type { FirewallPolicyConfig, HopDepth } from '@/types/veinpay';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpCallToolResult {
  [x: string]: unknown;
  content: McpTextContent[];
  isError?: boolean;
}

export const TIGERGRAPH_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'graph__run_query',
    description:
      'Runs a pre-installed GSQL query on a TigerGraph graph (e.g., "veinpay_firewall_check" on "VeinPayGraph"). Compatible with TigerGraph-MCP and TigerGraph RESTPP.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: {
          type: 'string',
          description: 'The name of the graph (defaults to "VeinPayGraph").',
        },
        query_name: {
          type: 'string',
          description: 'The name of the installed GSQL query to execute (e.g. "veinpay_firewall_check").',
        },
        params: {
          type: 'object',
          description:
            'Parameters for the GSQL query. For veinpay_firewall_check: { target_wallet, merchant_wallet, max_hops, sybil_threshold }.',
        },
      },
      required: ['query_name'],
    },
  },
  {
    name: 'graph__get_schema',
    description:
      'Retrieves the schema of the specified graph, including vertex types, edge types, and their attributes.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: {
          type: 'string',
          description: 'The name of the graph (defaults to "VeinPayGraph").',
        },
      },
    },
  },
  {
    name: 'graph__get_neighbors',
    description:
      'Retrieves the neighbors of a given node in the graph, with optional filtering by edge type or direction.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
        node_id: { type: 'string', description: 'The primary ID / wallet address of the node.' },
        direction: {
          type: 'string',
          enum: ['inbound', 'outbound', 'both'],
          description: 'Edge direction (default: "both").',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'graph__breadth_first_search',
    description:
      'Performs a cycle-safe breadth-first search (BFS) starting from a source node up to a specified depth.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
        source_node: { type: 'string', description: 'Starting vertex address.' },
        max_depth: {
          type: 'number',
          description: 'Maximum traversal hop depth (1 to 5, default: 3).',
        },
      },
      required: ['source_node'],
    },
  },
  {
    name: 'graph__get_node_data',
    description: 'Retrieves attributes and metadata for a specific vertex in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
        node_id: { type: 'string', description: 'The primary ID / address of the node.' },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'graph__get_nodes',
    description: 'Lists vertices in the graph, optionally filtered by vertex type.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
        vertex_type: {
          type: 'string',
          enum: ['Wallet', 'Merchant', 'ThreatEntity', 'All'],
          description: 'Vertex type to filter by.',
        },
        limit: { type: 'number', description: 'Maximum number of nodes to return (default: 50).' },
      },
    },
  },
  {
    name: 'graph__degree',
    description: 'Computes in-degree, out-degree, and total degree of a node.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
        node_id: { type: 'string', description: 'The vertex address.' },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'graph__number_of_nodes',
    description: 'Returns the total count of vertices in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
      },
    },
  },
  {
    name: 'graph__number_of_edges',
    description: 'Returns the total count of directed edges in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
      },
    },
  },
];

export async function executeTigerGraphMcpTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<McpCallToolResult> {
  const dataset: SeedGraphDataset = buildSeededGraphDataset();
  const graphName = typeof args.graph_name === 'string' ? args.graph_name : 'VeinPayGraph';

  const normalizedName = name
    .replace(/^tigergraph__/, 'graph__')
    .replace('graph__run_installed_query', 'graph__run_query');

  switch (normalizedName) {
    case 'graph__run_query': {
      const queryName = String(args.query_name || '');
      const params = (args.params || {}) as Record<string, unknown>;

      if (queryName === 'veinpay_firewall_check') {
        const targetWallet = String(params.target_wallet || params.targetWallet || '');
        const merchantWallet = String(params.merchant_wallet || params.merchantWallet || '');
        const rawHops = Number(params.max_hops || params.maxHops || 3);
        const maxHops: HopDepth = (Math.min(5, Math.max(1, rawHops)) as HopDepth);
        const sybilThreshold = Number(params.sybil_threshold || params.sybilBlockThreshold || 10);

        if (!targetWallet) {
          return {
            content: [{ type: 'text', text: 'Error: target_wallet parameter is required for veinpay_firewall_check.' }],
            isError: true,
          };
        }

        const policy: FirewallPolicyConfig = {
          firewallEnabled: true,
          maxHops,
          cleanLinkEnabled: true,
          unbundleEnabled: true,
          socketAutoBridgeEnabled: true,
          sybilBlockThreshold: sybilThreshold,
          inconclusivePolicy: 'BLOCK',
        };

        // Try live TigerGraph RESTPP if credentials configured
        const liveResult = await tryExecuteLiveTigerGraphQuery({
          targetWallet,
          merchantWallet,
          policy,
        });

        if (liveResult) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    source: 'TIGERGRAPH_RESTPP_LIVE',
                    graph: graphName,
                    query: queryName,
                    results: [
                      {
                        verdict: liveResult.verdict,
                        socketUnlocked: liveResult.socketUnlocked,
                        taint_hits: liveResult.taintHits,
                        min_taint_hop: liveResult.minTaintHop,
                        sybil_cluster_size: liveResult.sybilClusterSize,
                        dust_out_degree: liveResult.dustOutDegree,
                        nodes_scanned: liveResult.nodesScanned,
                        edges_traversed: liveResult.edgesTraversed,
                        execution_time_ms: liveResult.executionTimeMs,
                      },
                    ],
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Run high-fidelity in-memory GSQL engine
        const localResult = runVeinPayFirewallTraversal({
          targetWallet,
          merchantWallet,
          policy,
          customDataset: dataset,
          executionSource: 'IN_MEMORY_GSQL_ENGINE',
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  source: 'IN_MEMORY_GSQL_ENGINE',
                  graph: graphName,
                  query: queryName,
                  results: [
                    {
                      verdict: localResult.verdict,
                      socketUnlocked: localResult.socketUnlocked,
                      taint_hits: localResult.taintHits,
                      min_taint_hop: localResult.minTaintHop,
                      sybil_cluster_size: localResult.sybilClusterSize,
                      dust_out_degree: localResult.dustOutDegree,
                      nodes_scanned: localResult.nodesScanned,
                      edges_traversed: localResult.edgesTraversed,
                      execution_time_ms: localResult.executionTimeMs,
                      evidence_edges: localResult.evidenceEdges.map((e) => ({
                        id: e.id,
                        from: e.from_id,
                        to: e.to_id,
                        token: e.attributes.token,
                        amount: e.attributes.amount,
                        amount_usd: e.attributes.amount_usd,
                      })),
                    },
                  ],
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [{ type: 'text', text: `Unknown query '${queryName}' on graph '${graphName}'. Available: veinpay_firewall_check` }],
        isError: true,
      };
    }

    case 'graph__get_schema': {
      const schema = {
        graph: graphName,
        vertex_types: [
          {
            name: 'Wallet',
            primary_id: 'address STRING',
            attributes: [
              { name: 'label', type: 'STRING' },
              { name: 'risk_tag', type: 'STRING' },
              { name: 'chain_id', type: 'INT' },
              { name: 'is_flagged_threat', type: 'BOOL' },
              { name: 'first_seen', type: 'DATETIME' },
            ],
          },
          {
            name: 'Merchant',
            primary_id: 'address STRING',
            attributes: [
              { name: 'handle', type: 'STRING' },
              { name: 'vault_type', type: 'STRING' },
              { name: 'default_chain_id', type: 'INT' },
              { name: 'created_at', type: 'DATETIME' },
            ],
          },
          {
            name: 'ThreatEntity',
            primary_id: 'address STRING',
            attributes: [
              { name: 'entity_name', type: 'STRING' },
              { name: 'risk_category', type: 'STRING' },
              { name: 'threat_source', type: 'STRING' },
              { name: 'severity_score', type: 'INT' },
              { name: 'reported_at', type: 'DATETIME' },
            ],
          },
        ],
        edge_types: [
          {
            name: 'TRANSFERRED_TO',
            from_vertex_types: ['Wallet', 'ThreatEntity', 'Merchant'],
            to_vertex_types: ['Wallet', 'Merchant', 'ThreatEntity'],
            is_directed: true,
            attributes: [
              { name: 'amount', type: 'DOUBLE' },
              { name: 'amount_usd', type: 'DOUBLE' },
              { name: 'token', type: 'STRING' },
              { name: 'tx_hash', type: 'STRING' },
              { name: 'block_number', type: 'INT' },
              { name: 'tx_timestamp', type: 'DATETIME' },
            ],
          },
          {
            name: 'DUSTED',
            from_vertex_types: ['Wallet', 'ThreatEntity'],
            to_vertex_types: ['Wallet', 'Merchant'],
            is_directed: true,
            attributes: [
              { name: 'amount', type: 'DOUBLE' },
              { name: 'amount_usd', type: 'DOUBLE' },
              { name: 'token', type: 'STRING' },
              { name: 'tx_hash', type: 'STRING' },
            ],
          },
        ],
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }],
      };
    }

    case 'graph__get_node_data': {
      const nodeId = String(args.node_id || '').trim().toLowerCase();
      const node = dataset.vertices.get(nodeId);
      if (!node) {
        return {
          content: [{ type: 'text', text: `Node '${args.node_id}' not found in graph '${graphName}'.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(node, null, 2) }],
      };
    }

    case 'graph__get_nodes': {
      const vType = typeof args.vertex_type === 'string' ? args.vertex_type : 'All';
      const limit = typeof args.limit === 'number' ? Math.max(1, args.limit) : 50;

      let list = Array.from(dataset.vertices.values());
      if (vType !== 'All') {
        list = list.filter((v) => v.v_type.toLowerCase() === vType.toLowerCase());
      }
      const sliced = list.slice(0, limit);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                graph: graphName,
                total_matching: list.length,
                returned: sliced.length,
                nodes: sliced,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'graph__get_neighbors': {
      const nodeId = String(args.node_id || '').trim().toLowerCase();
      const direction = String(args.direction || 'both');

      const inboundEdges = dataset.edges.filter((e) => e.to_id.toLowerCase() === nodeId);
      const outboundEdges = dataset.edges.filter((e) => e.from_id.toLowerCase() === nodeId);

      const neighbors: Array<{ id: string; direction: 'inbound' | 'outbound'; edge: unknown }> = [];

      if (direction === 'inbound' || direction === 'both') {
        for (const e of inboundEdges) {
          neighbors.push({ id: e.from_id, direction: 'inbound', edge: e });
        }
      }
      if (direction === 'outbound' || direction === 'both') {
        for (const e of outboundEdges) {
          neighbors.push({ id: e.to_id, direction: 'outbound', edge: e });
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                graph: graphName,
                node_id: args.node_id,
                total_neighbors: neighbors.length,
                neighbors,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'graph__breadth_first_search': {
      const sourceNode = String(args.source_node || '').trim().toLowerCase();
      const maxDepth = Math.min(5, Math.max(1, Number(args.max_depth || 3)));

      const visited = new Set<string>([sourceNode]);
      let currentWave: string[] = [sourceNode];
      const discoveredLevels: Record<number, string[]> = { 0: [sourceNode] };
      const traversedEdges: unknown[] = [];

      for (let depth = 1; depth <= maxDepth; depth++) {
        const nextWave: string[] = [];
        for (const node of currentWave) {
          const connected = dataset.edges.filter(
            (e) => e.from_id.toLowerCase() === node || e.to_id.toLowerCase() === node
          );
          for (const edge of connected) {
            const peer =
              edge.from_id.toLowerCase() === node
                ? edge.to_id.toLowerCase()
                : edge.from_id.toLowerCase();
            if (!visited.has(peer)) {
              visited.add(peer);
              nextWave.push(peer);
              traversedEdges.push(edge);
            }
          }
        }
        if (nextWave.length === 0) break;
        discoveredLevels[depth] = nextWave;
        currentWave = nextWave;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                graph: graphName,
                source_node: args.source_node,
                max_depth: maxDepth,
                total_nodes_visited: visited.size,
                levels: discoveredLevels,
                edges_traversed: traversedEdges.length,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'graph__degree': {
      const nodeId = String(args.node_id || '').trim().toLowerCase();
      const inDegree = dataset.edges.filter((e) => e.to_id.toLowerCase() === nodeId).length;
      const outDegree = dataset.edges.filter((e) => e.from_id.toLowerCase() === nodeId).length;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              graph: graphName,
              node_id: args.node_id,
              in_degree: inDegree,
              out_degree: outDegree,
              total_degree: inDegree + outDegree,
            }),
          },
        ],
      };
    }

    case 'graph__number_of_nodes': {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              graph: graphName,
              number_of_nodes: dataset.vertices.size,
            }),
          },
        ],
      };
    }

    case 'graph__number_of_edges': {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              graph: graphName,
              number_of_edges: dataset.edges.length,
            }),
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown TigerGraph MCP tool: '${name}'` }],
        isError: true,
      };
  }
}
