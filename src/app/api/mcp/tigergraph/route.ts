import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createVeilPayMcpServer } from '@/lib/mcp/server';
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
      'Official Model Context Protocol (MCP) server for VeilPay 3-in-1 Pre-Flight Graph Firewall & TigerGraph Engine.',
    endpoints: {
      http: '/api/mcp/tigergraph',
      stdio: 'scripts/tigergraph-mcp-stdio.mjs',
    },
    tools: [
      'veilpay_scan_wallet',
      'veilpay_check_recipient',
      'veilpay_verify_receipt',
      'tigergraph_run_veilpay_query',
      'tigergraph_get_neighbors',
      'tigergraph_get_schema',
      'graph__run_query',
      'graph__get_schema',
      'graph__get_neighbors',
      'graph__breadth_first_search',
      'graph__get_node_data',
      'graph__get_nodes',
      'graph__degree',
      'graph__number_of_nodes',
      'graph__number_of_edges',
    ],
  });
}

function verifyMcpAuthorization(request: NextRequest): { authorized: boolean; reason?: string } {
  const isDev = process.env.NODE_ENV !== 'production';
  const allowAnonymous = process.env.ALLOW_ANONYMOUS_MCP === 'true';

  const mcpApiKey = process.env.MCP_API_KEY?.trim();

  // If MCP_API_KEY is configured, enforce it unless explicitly in dev with ALLOW_ANONYMOUS_MCP=true
  if (mcpApiKey) {
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      if (isDev && allowAnonymous) {
        return { authorized: true };
      }
      return { authorized: false, reason: 'Missing Authorization: Bearer <MCP_API_KEY> header.' };
    }
    const token = authHeader.slice(7).trim();
    if (token !== mcpApiKey) {
      return { authorized: false, reason: 'Invalid MCP API Key.' };
    }
    return { authorized: true };
  }

  // If no MCP_API_KEY is set:
  if (isDev) {
    return { authorized: true };
  }

  return { authorized: false, reason: 'MCP_API_KEY is not configured on server.' };
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

  const auth = verifyMcpAuthorization(request);
  if (!auth.authorized) {
    return NextResponse.json(
      {
        error: 'UNAUTHORIZED',
        message: auth.reason || 'Unauthorized access to TigerGraph MCP endpoint.',
      },
      { status: 401 }
    );
  }

  try {
    const originalAccept = request.headers.get('accept') || '';
    const wantsEventStream = originalAccept.includes('text/event-stream');

    let reqBodyText = await request.text();
    try {
      const parsedBody = JSON.parse(reqBodyText);
      if (parsedBody && parsedBody.method === 'initialize') {
        parsedBody.params = parsedBody.params || {};
        if (!parsedBody.params.capabilities) {
          parsedBody.params.capabilities = {};
        }
        if (!parsedBody.params.clientInfo) {
          parsedBody.params.clientInfo = { name: 'mcp-client', version: '1.0.0' };
        }
        reqBodyText = JSON.stringify(parsedBody);
      }
    } catch {
      // ignore parse errors here, let transport handle invalid JSON
    }

    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    // Ensure both are present so SDK transport passes its validation
    headers.set('accept', 'application/json, text/event-stream');

    const normalizedReq = new Request(request.url, {
      method: 'POST',
      headers,
      body: reqBodyText,
    });

    const mcpServer = createVeilPayMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport();
    await mcpServer.connect(transport);

    const mcpResponse = await transport.handleRequest(normalizedReq);

    // If caller explicitly requested text/event-stream, stream back natively
    if (wantsEventStream) {
      return mcpResponse;
    }

    // For standard JSON-RPC callers (tests, direct fetch), extract JSON from SSE data event
    const sseText = await mcpResponse.text();
    const match = sseText.match(/^data:\s*(.+)$/m);
    if (match) {
      try {
        const jsonPayload = JSON.parse(match[1]);
        return NextResponse.json(jsonPayload, { status: mcpResponse.status });
      } catch {
        // Fall through
      }
    }

    try {
      const parsed = JSON.parse(sseText);
      return NextResponse.json(parsed, { status: mcpResponse.status });
    } catch {
      return new NextResponse(sseText, {
        status: mcpResponse.status,
        headers: { 'content-type': mcpResponse.headers.get('content-type') || 'text/plain' },
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal MCP server error',
        },
      },
      { status: 500 }
    );
  }
}
