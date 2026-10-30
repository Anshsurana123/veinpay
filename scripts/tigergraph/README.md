# VeilPay — TigerGraph 4.x Integration Guide

This guide describes how to configure, schema-load, and seed a TigerGraph 4.x or 3.x cluster (Savanna Cloud or self-hosted Enterprise) for VeilPay.

---

## 1. Environment Configuration

Add the following environment variables to your `.env.local` or production deployment:

```bash
# Target TigerGraph RESTPP endpoint
TIGERGRAPH_HOST=https://your-domain.tigergraph.cloud

# Target graph name (defaults to VeilPayGraph)
TIGERGRAPH_GRAPH=VeilPayGraph

# Option A: Static RESTPP / GSQL Bearer token
TIGERGRAPH_TOKEN=your-bearer-token

# Option B: Dynamic Secret for automatic token acquisition via /gsql/v1/tokens
TIGERGRAPH_SECRET=your-gsql-secret

# Query timeout budget in milliseconds (default: 4000)
TIGERGRAPH_TIMEOUT_MS=4000
```

---

## 2. Deploy Schema & Install GSQL Queries

Deploy the schema and pre-sign graph firewall queries using the GSQL web shell or CLI:

```bash
gsql /tigergraph/veilpay_firewall.gsql
```

This installs:
1. Vertices: `Address`, `Link`
2. Directed Edges with Discriminators: `FUNDED`, `DUSTED`, `FIRST_FUNDED`, `PAID_LINK`
3. Queries:
   - `veilpay_firewall_check`: 3-in-1 backward lineage, sybil cluster & dust factory analysis.
   - `veilpay_trusted_contacts`: counterparty discovery with >= 2 successful non-dust interactions.
   - `veilpay_poison_check`: lookalike prefix/suffix evaluation.
   - `veilpay_neighbors`: N-hop topology subgraph retrieval.

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
curl -X POST "$TIGERGRAPH_HOST/restpp/query/$TIGERGRAPH_GRAPH/veilpay_firewall_check" \
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
