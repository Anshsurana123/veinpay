import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { runVeilPayFirewallTraversal } from '@/lib/graph/engine';
import { scanWithTigerGraph } from '@/lib/graph/tigergraph/orchestrator';
import { getTigerGraphConfig } from '@/lib/graph/tigergraph/config';
import { executeTigerGraphQuery } from '@/lib/graph/tigergraph/client';
import { evaluateOutboundPoisonRisk } from '@/lib/graph/poison-guard';
import { verifyAigiReceiptData } from '@/lib/aigi/verify-helper';
import { executeTigerGraphMcpTool } from '@/lib/graph/tigergraph-mcp';
import type { FirewallPolicyConfig, HopDepth } from '@/types/veilpay';

export function createVeilPayMcpServer(): McpServer {
  const server = new McpServer({
    name: 'tigergraph-mcp-veilpay',
    version: '1.0.0',
  });

  // 1. veilpay_scan_wallet
  server.tool(
    'veilpay_scan_wallet',
    {
      address: z.string().describe('Target EVM/wallet address to scan'),
      chainId: z.number().optional().default(1).describe('Chain ID (e.g. 1, 42161, 8453)'),
      maxHops: z.number().min(1).max(5).optional().default(3).describe('Traversal hop depth (1 to 5)'),
      cleanLink: z.boolean().optional().default(true).describe('Enable CleanLink drainer/exploit detection'),
      unbundle: z.boolean().optional().default(true).describe('Enable Unbundle sybil cluster detection'),
      inconclusivePolicy: z.enum(['BLOCK', 'WARN']).optional().default('BLOCK').describe('Action on inconclusive crawl/presence'),
    },
    async ({ address, chainId, maxHops, cleanLink, unbundle, inconclusivePolicy }) => {
      const policy: FirewallPolicyConfig = {
        firewallEnabled: true,
        maxHops: maxHops as HopDepth,
        cleanLinkEnabled: cleanLink,
        unbundleEnabled: unbundle,
        socketAutoBridgeEnabled: true,
        sybilBlockThreshold: 10,
        inconclusivePolicy,
      };

      let scanResult;
      const tgConfig = getTigerGraphConfig();
      if (tgConfig) {
        scanResult = await scanWithTigerGraph({
          targetWallet: address,
          chainId,
          policy,
        });
      }
      if (!scanResult) {
        scanResult = runVeilPayFirewallTraversal({
          targetWallet: address,
          policy,
        });
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(scanResult, null, 2) }],
      };
    }
  );

  // 2. veilpay_check_recipient
  server.tool(
    'veilpay_check_recipient',
    {
      candidateAddress: z.string().describe('Candidate recipient address to inspect for lookalike mimicry or dust poisoning'),
      senderAddress: z.string().optional().describe('Sender address to derive transaction contact history from'),
      expectedMode: z.enum(['EVM_SOCKET', 'BTC_SILENT_PAYMENT', 'XMR_SUBADDRESS']).optional().default('EVM_SOCKET'),
    },
    async ({ candidateAddress, senderAddress, expectedMode }) => {
      const result = evaluateOutboundPoisonRisk({
        candidateInput: candidateAddress,
        senderAddress,
        expectedMode,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 3. veilpay_verify_receipt
  server.tool(
    'veilpay_verify_receipt',
    {
      receiptJson: z.string().describe('JSON string of the AIGI forensic compliance receipt to verify'),
    },
    async ({ receiptJson }) => {
      try {
        const parsed = JSON.parse(receiptJson);
        const result = verifyAigiReceiptData({
          receipt: parsed,
          canonicalPayloadJson: parsed.canonicalPayloadJson,
          commitmentHash: parsed.commitmentHash ?? parsed.cryptographicAuditHash,
          signature: parsed.signature,
          keyId: parsed.keyId,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to parse or verify receipt: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  // 4. tigergraph_run_veilpay_query
  server.tool(
    'tigergraph_run_veilpay_query',
    {
      queryName: z.string().describe('Pre-installed TigerGraph query name (must start with veilpay_)'),
      params: z.record(z.string(), z.unknown()).optional().default({}).describe('Parameters to pass to the query'),
    },
    async ({ queryName, params }) => {
      if (!queryName.startsWith('veilpay_')) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Forbidden query "${queryName}". Only veilpay_* queries may be executed.`,
            },
          ],
        };
      }

      const res = await executeTigerGraphQuery({
        queryName,
        params,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      };
    }
  );

  // 5. tigergraph_get_neighbors
  server.tool(
    'tigergraph_get_neighbors',
    {
      vertexId: z.string().describe('Primary ID / wallet address of vertex'),
      vertexType: z.enum(['Wallet', 'Merchant', 'ThreatEntity']).optional().default('Wallet'),
      direction: z.enum(['inbound', 'outbound', 'both']).optional().default('both'),
      limit: z.number().optional().default(50),
    },
    async ({ vertexId, direction, limit }) => {
      const legacyRes = await executeTigerGraphMcpTool('graph__get_neighbors', {
        node_id: vertexId,
        direction,
        limit,
      });
      return legacyRes;
    }
  );

  // 6. tigergraph_get_schema
  server.tool(
    'tigergraph_get_schema',
    {},
    async () => {
      const legacyRes = await executeTigerGraphMcpTool('graph__get_schema', {
        graph_name: 'VeilPayGraph',
      });
      return legacyRes;
    }
  );

  // Legacy compatibility tools
  server.tool(
    'graph__run_query',
    {
      graph_name: z.string().optional().default('VeilPayGraph'),
      query_name: z.string(),
      params: z.record(z.string(), z.unknown()).optional().default({}),
    },
    async ({ query_name, params, graph_name }) => {
      return await executeTigerGraphMcpTool('graph__run_query', {
        graph_name,
        query_name,
        params,
      });
    }
  );

  server.tool(
    'graph__get_schema',
    {
      graph_name: z.string().optional().default('VeilPayGraph'),
    },
    async ({ graph_name }) => {
      return await executeTigerGraphMcpTool('graph__get_schema', { graph_name });
    }
  );

  server.tool(
    'graph__get_neighbors',
    {
      graph_name: z.string().optional().default('VeilPayGraph'),
      node_id: z.string(),
      direction: z.enum(['inbound', 'outbound', 'both']).optional().default('both'),
    },
    async (args) => {
      return await executeTigerGraphMcpTool('graph__get_neighbors', args);
    }
  );

  server.tool(
    'graph__breadth_first_search',
    {
      graph_name: z.string().optional().default('VeilPayGraph'),
      source_node: z.string(),
      max_depth: z.number().min(1).max(5).optional().default(3),
    },
    async (args) => {
      return await executeTigerGraphMcpTool('graph__breadth_first_search', args);
    }
  );

  server.tool(
    'graph__get_node_data',
    {
      graph_name: z.string().optional().default('VeilPayGraph'),
      node_id: z.string(),
    },
    async (args) => {
      return await executeTigerGraphMcpTool('graph__get_node_data', args);
    }
  );

  server.tool(
    'graph__get_nodes',
    {
      graph_name: z.string().optional().default('VeilPayGraph'),
      vertex_type: z.enum(['Wallet', 'Merchant', 'ThreatEntity', 'All']).optional().default('All'),
      limit: z.number().optional().default(50),
    },
    async (args) => {
      return await executeTigerGraphMcpTool('graph__get_nodes', args);
    }
  );

  server.tool(
    'graph__degree',
    {
      graph_name: z.string().optional().default('VeilPayGraph'),
      node_id: z.string(),
    },
    async (args) => {
      return await executeTigerGraphMcpTool('graph__degree', args);
    }
  );

  server.tool(
    'graph__number_of_nodes',
    {
      graph_name: z.string().optional().default('VeilPayGraph'),
    },
    async (args) => {
      return await executeTigerGraphMcpTool('graph__number_of_nodes', args);
    }
  );

  server.tool(
    'graph__number_of_edges',
    {
      graph_name: z.string().optional().default('VeilPayGraph'),
    },
    async (args) => {
      return await executeTigerGraphMcpTool('graph__number_of_edges', args);
    }
  );

  return server;
}
