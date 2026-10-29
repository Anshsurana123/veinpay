import { NextRequest, NextResponse } from 'next/server';
import {
  TIGERGRAPH_MCP_TOOLS,
  executeTigerGraphMcpTool,
} from '@/lib/graph/tigergraph-mcp';
import {
  buildRateLimitExceededResponse,
  checkRateLimit,
  getClientIp,
} from '@/lib/security/rate-limit';

export async function GET() {
  return NextResponse.json({
    server: 'TigerGraph-MCP-VeilPay',
    version: '1.0.0',
    protocol: 'model-context-protocol',
    description:
      'TigerGraph MCP endpoint for VeilPay 3-in-1 Pre-Flight Graph Firewall & Topological Analysis.',
    tools: TIGERGRAPH_MCP_TOOLS,
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit('tigergraph-mcp', ip, {
    limit: 60,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return buildRateLimitExceededResponse(rateLimit);
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;

    // Support JSON-RPC 2.0 (method: 'tools/list' or 'tools/call')
    if (body.method === 'tools/list') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id ?? 1,
        result: {
          tools: TIGERGRAPH_MCP_TOOLS,
        },
      });
    }

    if (body.method === 'tools/call') {
      const params = (body.params || {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const toolName = params.name;
      if (!toolName) {
        return NextResponse.json(
          {
            jsonrpc: '2.0',
            id: body.id ?? null,
            error: { code: -32602, message: "Missing required parameter 'name'." },
          },
          { status: 400 }
        );
      }

      const toolResult = await executeTigerGraphMcpTool(
        toolName,
        params.arguments || {}
      );
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id ?? 1,
        result: toolResult,
      });
    }

    // Direct tool call format: { tool: 'graph__run_query', args: { ... } } or { name: '...', arguments: { ... } }
    const toolName = String(body.tool || body.name || '');
    const toolArgs = (body.args || body.arguments || {}) as Record<string, unknown>;

    if (!toolName) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid MCP request. Expected 'tool' (or 'name') in body, or JSON-RPC format with 'method: tools/call'.",
          availableTools: TIGERGRAPH_MCP_TOOLS.map((t) => t.name),
        },
        { status: 400 }
      );
    }

    const result = await executeTigerGraphMcpTool(toolName, toolArgs);
    return NextResponse.json({
      success: !result.isError,
      tool: toolName,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'TigerGraph MCP execution error',
      },
      { status: 500 }
    );
  }
}
