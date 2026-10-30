# VeinPay — TigerGraph 4.x Integration Guide

This guide describes how to configure, schema-load, and seed a TigerGraph 4.x or 3.x cluster (Savanna Cloud or self-hosted Enterprise) for VeinPay.

---

## 1. Environment Configuration

Add the following environment variables to your `.env.local` or production deployment:

```bash
# Target TigerGraph RESTPP endpoint
TIGERGRAPH_HOST=https://your-domain.tigergraph.cloud

# Target graph name (defaults to VeinPayGraph)
TIGERGRAPH_GRAPH=VeinPayGraph

# Option A: Static RESTPP / GSQL Bearer token
TIGERGRAPH_TOKEN=your-bearer-token

# Option B: Dynamic Secret for automatic token acquisition via /gsql/v1/tokens
TIGERGRAPH_SECRET=your-gsql-secret

# Query timeout budget in milliseconds (default: 4000)
TIGERGRAPH_TIMEOUT_MS=4000
```

---

## 2. Deploy Schema & Install GSQL Queries

Deploy the schema and pre-sign graph firewall queries using the GSQL CLI or TigerGraph Cloud Web Console / GraphStudio:

### Option A: Via GSQL Command Line (Recommended)
```bash
# Optional: if you need to wipe an old test schema on your cluster first
gsql "DROP ALL"

# Run the batch script (top-level DDL commands without semicolons)
gsql tigergraph/veinpay_firewall.gsql
```

### Option B: Interactive GSQL Shell or Web Shell
If using the interactive `GSQL>` prompt, always ensure you are in the global scope before creating global schema components:
```gsql
GSQL> USE GLOBAL
GSQL> @tigergraph/veinpay_firewall.gsql
```

### Option C: TigerGraph GraphStudio UI
1. **Design Schema**: Create vertices `Wallet`, `Merchant`, `ThreatEntity`, `Address` and directed edges `TRANSFERRED_TO`, `DUSTED`, `FUNDED` (with reverse edges). Publish Schema.
2. **Write Queries**: Copy the queries from `/tigergraph/veinpay_firewall.gsql` (`veinpay_firewall_check`, `veinpay_trusted_contacts`, `veinpay_poison_check`, `veinpay_neighbors`) into the query editor and click **Install All Queries**.

This installs:
1. Vertices: `Wallet`, `Merchant`, `ThreatEntity`, `Address`
2. Directed Edges: `TRANSFERRED_TO` (reverse `REVERSE_TRANSFERRED_TO`), `DUSTED` (reverse `REVERSE_DUSTED`), `FUNDED` (reverse `REVERSE_FUNDED`)
3. Compiled RESTPP Queries:
   - `veinpay_firewall_check`: 3-in-1 backward lineage traversal, sybil cluster collapse & dust factory analysis.
   - `veinpay_trusted_contacts`: counterparty discovery with >= 2 successful non-dust interactions.
   - `veinpay_poison_check`: lookalike prefix/suffix evaluation & dust history.
   - `veinpay_neighbors`: N-hop topology subgraph retrieval.

---

## 3. Seed Threat Intelligence Snapshot & Institutional Hubs

Run the automated seeding script:

```bash
node scripts/tigergraph/seed.mjs
```

This ingests:
- ScamSniffer, OFAC, and major exploit drainer vertices into the `Address` vertex set.
- Institutional whitelisted hubs (Uniswap V3, Coinbase, Circle, Aave, Arbitrum Bridge) with `is_hub=true` to terminate sybil clusters.

---

## 4. Test RESTPP Query Execution

Verify your deployment with `curl`:

```bash
curl -X POST "$TIGERGRAPH_HOST/restpp/query/$TIGERGRAPH_GRAPH/veinpay_firewall_check" \
  -H "Authorization: Bearer $TIGERGRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_wallet": {"id": "0x4F2a9c117034e8B1200499A1c3f88200000188E1", "type": "Address"},
    "merchant_wallet": {"id": "0x1111111111111111111111111111111111111111", "type": "Address"},
    "max_hops": 3,
    "sybil_threshold": 10,
    "clean_link_enabled": true,
    "unbundle_enabled": true,
    "firewall_enabled": true
  }'
```
