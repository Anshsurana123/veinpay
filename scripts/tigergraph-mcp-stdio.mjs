#!/usr/bin/env node
/**
 * VeilPay TigerGraph MCP Stdio Server
 * Compatible with Model Context Protocol (MCP) clients (Claude Desktop, Cursor, Antigravity, LangGraph).
 * Exposes TigerGraph tools for graph querying, neighbor exploration, BFS traversal, and schema inspection.
 */

import readline from 'node:readline';

const TIGERGRAPH_MCP_TOOLS = [
  {
    name: 'graph__run_query',
    description: 'Runs a pre-installed GSQL query on a TigerGraph graph (e.g. veilpay_firewall_check on VeilPayGraph).',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
        query_name: { type: 'string', description: 'GSQL query name.' },
        params: { type: 'object', description: 'Query parameters.' },
      },
      required: ['query_name'],
    },
  },
  {
    name: 'graph__get_schema',
    description: 'Retrieves the schema of the specified graph, including vertex and edge types.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
      },
    },
  },
  {
    name: 'graph__get_neighbors',
    description: 'Retrieves 1-hop connected neighbors of a given node in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
        node_id: { type: 'string', description: 'Vertex address/ID.' },
        direction: { type: 'string', enum: ['inbound', 'outbound', 'both'] },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'graph__breadth_first_search',
    description: 'Performs a cycle-safe breadth-first search starting from a source node.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
        source_node: { type: 'string', description: 'Starting vertex address.' },
        max_depth: { type: 'number', description: 'Max hops (1 to 5).' },
      },
      required: ['source_node'],
    },
  },
  {
    name: 'graph__get_node_data',
    description: 'Retrieves attributes and metadata for a specific vertex.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
        node_id: { type: 'string', description: 'The vertex address/ID.' },
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
    description: 'Returns total count of vertices in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
      },
    },
  },
  {
    name: 'graph__number_of_edges',
    description: 'Returns total count of edges in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        graph_name: { type: 'string', description: 'The graph name.' },
      },
    },
  },
];

async function callEndpoint(tool, args) {
  const host = process.env.VEILPAY_API_URL || 'http://localhost:3000';
  try {
    const res = await fetch(`${host}/api/mcp/tigergraph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        isError: true,
        content: [{ type: 'text', text: `HTTP ${res.status}: ${errText}` }],
      };
    }
    return await res.json();
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to connect to VeilPay MCP endpoint at ${host}: ${err.message}`,
        },
      ],
    };
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    const id = msg.id ?? null;

    if (msg.method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'tigergraph-mcp-veilpay',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
        },
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    if (msg.method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TIGERGRAPH_MCP_TOOLS,
        },
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    if (msg.method === 'tools/call') {
      const toolName = msg.params?.name;
      const toolArgs = msg.params?.arguments || {};
      const endpointResult = await callEndpoint(toolName, toolArgs);

      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          content: endpointResult.content || [{ type: 'text', text: JSON.stringify(endpointResult) }],
          isError: endpointResult.isError || false,
        },
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    // Default response for unhandled notifications or methods
    if (id !== null) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {},
        }) + '\n'
      );
    }
  } catch (err) {
    process.stderr.write(`Error processing line: ${err.message}\n`);
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed.id !== undefined && parsed.id !== null) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            error: { code: -32603, message: err.message },
          }) + '\n'
        );
      }
    } catch {
      // Input was not valid JSON
    }
  }
});
