#!/usr/bin/env node
/**
 * Live Smoke Test: GoPlus + Etherscan V2 + TigerGraph MCP
 */

import { checkGoPlusAddress, checkGoPlusToken, checkGoPlusApproval, checkGoPlusPhishing } from '../src/lib/security/goplus.ts';
import { executeTigerGraphMcpTool } from '../src/lib/graph/tigergraph-mcp.ts';
import { crawlLiveAddressAndScan } from '../src/lib/graph/live-crawler.ts';
import { AUTHORITATIVE_DEFAULT_POLICY } from '../src/lib/graph/full-scan.ts';

async function main() {
  console.log('=== VEINPAY TRI-INTEGRATION VERIFICATION ===\n');

  // 1. GoPlus Live API Key Check
  console.log('1. Testing GoPlus Live API Key with Address Security...');
  process.env.GOPLUS_API_KEY = 'uavkEBgeNgPU68a3dXMXEb6JBpJkFgJK';
  const testDrainer = '0x16Af29b7eFbf019ef30aae9023A5140c012374A5'; // Known BSC threat
  const goplusRes = await checkGoPlusAddress(testDrainer, 56);
  console.log(`   Address: ${testDrainer}`);
  console.log(`   Is Threat: ${goplusRes.isThreat}`);
  console.log(`   Category: ${goplusRes.riskCategory}`);
  console.log(`   Source: ${goplusRes.source}`);
  console.log(`   Details:`, goplusRes.details);
  if (!goplusRes.isThreat) throw new Error('GoPlus threat detection failed on known test address');
  console.log('   [PASS] GoPlus Address Security Live OK.\n');

  // 2. GoPlus Token Security Live Check
  console.log('2. Testing GoPlus Token Security (USDC Mainnet)...');
  const usdcAddr = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const tokenRes = await checkGoPlusToken(usdcAddr, 1);
  console.log(`   Token: ${tokenRes.tokenSymbol} (${tokenRes.tokenName})`);
  console.log(`   Is Honeypot: ${tokenRes.isHoneypot}`);
  console.log(`   Buy Tax: ${tokenRes.buyTaxPercent}% | Sell Tax: ${tokenRes.sellTaxPercent}%`);
  console.log(`   Safe to Trade: ${tokenRes.isSafeToTrade}`);
  if (!tokenRes.isSafeToTrade) throw new Error('GoPlus token security failed on USDC');
  console.log('   [PASS] GoPlus Token Security Live OK.\n');

  // 3. TigerGraph MCP Tool Execution
  console.log('3. Testing TigerGraph MCP Tool Execution (graph__run_query)...');
  const mcpQueryRes = await executeTigerGraphMcpTool('graph__run_query', {
    graph_name: 'VeinPayGraph',
    query_name: 'veinpay_firewall_check',
    params: {
      target_wallet: '0x99B1c402881a77e3d90123456789aB00000FDead',
      merchant_wallet: '0x71C84102070853531b783c5D2D563456F9960244',
      max_hops: 3,
      sybil_threshold: 10,
    },
  });
  const mcpData = JSON.parse(mcpQueryRes.content[0].text);
  console.log(`   Query: ${mcpData.query}`);
  console.log(`   Source: ${mcpData.source}`);
  console.log(`   Verdict: ${mcpData.results[0].verdict}`);
  console.log(`   Socket Unlocked: ${mcpData.results[0].socketUnlocked}`);
  console.log(`   Taint Hits: ${mcpData.results[0].taint_hits}`);
  if (mcpData.results[0].socketUnlocked !== false) throw new Error('TigerGraph MCP should block drainer');
  console.log('   [PASS] TigerGraph MCP Tool Execution OK.\n');

  // 4. Live Etherscan V2 + GoPlus + TigerGraph Crawler
  console.log('4. Testing Live Etherscan V2 + GoPlus + TigerGraph Crawler...');
  process.env.ETHERSCAN_API_KEY = 'CHWXFSHPKEVWRMXVI3IR6M81B3FDB1ZJNX';
  // Vitalik's address as a clean live EVM wallet
  const vitalik = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const crawlRes = await crawlLiveAddressAndScan({
    targetWallet: vitalik,
    merchantWallet: '0x71C84102070853531b783c5D2D563456F9960244',
    chainId: 1,
    policy: { ...AUTHORITATIVE_DEFAULT_POLICY, maxHops: 1 },
    crawlSettings: { maxApiCallsPerScan: 2, topFundersPerVertex: 2, crawlTimeoutMs: 8000 },
  });
  console.log(`   Scanned Wallet: ${crawlRes.targetWallet}`);
  console.log(`   Execution Source: ${crawlRes.executionSource}`);
  console.log(`   Verdict: ${crawlRes.verdict}`);
  console.log(`   Execution Time: ${crawlRes.executionTimeMs}ms`);
  console.log(`   Nodes Scanned: ${crawlRes.nodesScanned} | Edges Traversed: ${crawlRes.edgesTraversed}`);
  console.log(`   Live Notes: ${crawlRes.liveCrawlNotes}`);
  if (crawlRes.executionSource !== 'ETHERSCAN_V2_LIVE_CRAWL') throw new Error('Live crawl did not execute');
  console.log('   [PASS] Live Etherscan V2 + GoPlus + TigerGraph Crawler OK.\n');

  console.log('=== ALL INTEGRATION VERIFICATION CHECKS PASSED ===');
}

main().catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
