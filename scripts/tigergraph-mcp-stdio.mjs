#!/usr/bin/env node
/**
 * VeilPay TigerGraph MCP Stdio Server
 * Compatible with Model Context Protocol (MCP) clients (Claude Desktop, Cursor, Antigravity, Inspector).
 * Powered by official @modelcontextprotocol/sdk.
 */

import { register } from 'node:module';
register('./alias-loader.mjs', import.meta.url);

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function main() {
  const { createVeilPayMcpServer } = await import('../src/lib/mcp/server.ts');
  const server = createVeilPayMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error in TigerGraph MCP Stdio server:', err);
  process.exit(1);
});
