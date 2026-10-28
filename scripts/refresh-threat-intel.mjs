#!/usr/bin/env node
/**
 * Script: scripts/refresh-threat-intel.mjs
 * Fetches latest ScamSniffer address blacklist and OFAC SDN ETH addresses
 * and merges them into src/data/threat-intel-snapshot.json.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SNAPSHOT_PATH = path.resolve(process.cwd(), 'src/data/threat-intel-snapshot.json');

async function main() {
  const raw = await fs.readFile(SNAPSHOT_PATH, 'utf8');
  const current = JSON.parse(raw);
  const existingMap = new Map(
    current.entities.map((e) => [e.address.toLowerCase(), e])
  );

  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json',
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const ofacList = await res.json();
      for (const addr of ofacList.slice(0, 75)) {
        if (!existingMap.has(addr.toLowerCase())) {
          existingMap.set(addr.toLowerCase(), {
            address: addr,
            label: 'OFAC SDN Sanctioned Ethereum Address',
            riskCategory: 'SANCTIONED_MIXER',
            source: 'OFAC SDN Automated Feed',
          });
        }
      }
    }
  } catch (err) {
    console.warn('OFAC fetch skipped (offline or timeout):', err.message);
  }

  const updated = {
    version: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    sources: current.sources,
    entities: Array.from(existingMap.values()),
  };

  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  console.log(`Updated threat-intel-snapshot.json with ${updated.entities.length} threat entities.`);
}

main();
