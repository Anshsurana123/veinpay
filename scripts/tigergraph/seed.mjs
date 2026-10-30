#!/usr/bin/env node
/**
 * VeinPay — TigerGraph 4.x Database Seeding Script
 * File: scripts/tigergraph/seed.mjs
 *
 * Ingests threat intel snapshot entities, institutional whitelists,
 * and canonical demo topologies into a live TigerGraph 4.x cluster via RESTPP.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.TIGERGRAPH_HOST?.trim() || 'http://127.0.0.1:9000';
const GRAPH = process.env.TIGERGRAPH_GRAPH?.trim() || 'VeinPayGraph';
const SECRET = process.env.TIGERGRAPH_SECRET?.trim();
const TOKEN = process.env.TIGERGRAPH_TOKEN?.trim();

console.log(`[TigerGraph Seed] Target Host: ${HOST}`);
console.log(`[TigerGraph Seed] Target Graph: ${GRAPH}`);

async function acquireToken() {
  if (TOKEN) return TOKEN;
  if (!SECRET) {
    console.warn('[TigerGraph Seed] Neither TIGERGRAPH_TOKEN nor TIGERGRAPH_SECRET provided. Proceeding unauthenticated (dev mode).');
    return null;
  }

  const tokenUrl = `${HOST.replace(/\/+$/, '')}/gsql/v1/tokens`;
  console.log(`[TigerGraph Seed] Requesting token from ${tokenUrl}...`);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: SECRET,
      graph: GRAPH,
      lifetime: 604800000,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to acquire TigerGraph token: HTTP ${res.status}`);
  }

  const json = await res.json();
  return json.token;
}

async function seed() {
  const authToken = await acquireToken();

  const snapshotPath = path.resolve(__dirname, '../../src/data/threat-intel-snapshot.json');
  const snapshotData = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const entities = snapshotData.entities || [];

  console.log(`[TigerGraph Seed] Loaded ${entities.length} threat intel entities from snapshot.`);

  const vertices = {
    Address: {},
  };

  for (const ent of entities) {
    vertices.Address[ent.address] = {
      label: { value: ent.label || 'Known Threat' },
      risk_category: { value: ent.riskCategory || 'DRAINER' },
      is_flagged_threat: { value: true },
      is_hub: { value: false },
      is_contract: { value: false },
      inbound_complete: { value: true },
    };
  }

  // Institutional whitelisted hubs
  const hubs = [
    { address: '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443', label: 'Uniswap V3 Pool' },
    { address: '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43', label: 'Coinbase Hot Wallet' },
    { address: '0x55fe002aeff02f77364de339a1292923a15844b8', label: 'Circle Treasury' },
    { address: '0x794a61358d6845594f94dc1db02a252b5b4814ad', label: 'Aave V3 Pool' },
    { address: '0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a', label: 'Arbitrum Bridge' },
  ];

  for (const hub of hubs) {
    vertices.Address[hub.address] = {
      label: { value: hub.label },
      risk_category: { value: 'CLEAN_INSTITUTIONAL' },
      is_flagged_threat: { value: false },
      is_hub: { value: true },
      is_contract: { value: true },
      inbound_complete: { value: true },
    };
  }

  const payload = {
    vertices,
    edges: {},
  };

  const upsertUrl = `${HOST.replace(/\/+$/, '')}/restpp/graph/${encodeURIComponent(GRAPH)}`;
  console.log(`[TigerGraph Seed] Posting upsert payload to ${upsertUrl}...`);

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(upsertUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TigerGraph RESTPP upsert failed (HTTP ${res.status}): ${text}`);
  }

  const resultJson = await res.json();
  console.log('[TigerGraph Seed] Seed completed successfully!');
  console.log(`[TigerGraph Seed] Vertices seeded: ${Object.keys(vertices.Address).length}`);
  console.log('[TigerGraph Seed] Server response:', JSON.stringify(resultJson));
}

seed().catch((err) => {
  console.error('[TigerGraph Seed] Fatal error:', err.message);
  process.exit(1);
});
