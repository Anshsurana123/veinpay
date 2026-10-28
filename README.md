# VeilPay — Zero-Doxx Cross-Chain Payment Link & Pre-Sign Graph Firewall

> **Built for Hacker House Goa** — Unifying **TigerGraph** (3-in-1 Pre-Sign Graph Firewall), **AIGI** (Deterministic Forensic Agent + SHA-256 Compliance Receipts), **SOCKET Swap V3** (Cross-Chain Routing & Calldata), and **Cake Wallet** (EVM, BIP-352 Bitcoin Silent Payments `sp1...`, and Monero `888...` Destination Vaults).

---

## 1. Architecture & Four Core Pillars

```text
[Payer Wallet (Reown AppKit / 4-Persona Simulator / Custom Live Etherscan V2 Crawl)]
       │
       ▼
[1. TigerGraph 3-in-1 Pre-Flight Graph Firewall (<50ms)]
    ├── CleanLink:   1–5 Hop Backward Lineage Traversal (Drainers, Exploits, Sanctioned Mixers)
    ├── Unbundle:    Shared Root-Funder & Sybil Cluster / Cyclic Wash-Ring Detection
    └── PoisonGraph: Outbound Lookalike Prefix/Suffix Byte Diff & Dust-Factory Out-Degree Guard
       │
       ├──► IF BLOCKED (or Warned):
       │      • Render Interactive 2D Topological Subgraph + Red Contagion Path
       │      • Generate AIGI Deterministic Forensic Verdict & SHA-256 Compliance Receipt
       │      • Hard-Lock SOCKET Swap V3 Quote & Redact Native BTC/XMR Destination Vault URIs
       │
       └──► IF CLEAN (or Policy Bypassed with Advisory):
              • Unlock SOCKET Swap V3 API (/v3/swap/quote)
              • Unlock Cake Wallet Default Destination Vault Settlement
                ├── Mode 1: Multi-Chain EVM (Auto-Bridged via SOCKET to Cake Wallet)
                ├── Mode 2: Bitcoin Silent Payments (BIP-352 sp1... via BIP-321 QR/URI)
                └── Mode 3: Monero Subaddress (RingCT 888... via monero: QR/URI)
```

---

## 2. Quick Start & Verification

```bash
# 1. Install dependencies
npm install

# 2. Run the 14-test Vitest algorithmic verification suite
npm run test -- --run

# 3. Start the Next.js development server
npm run dev

# 4. Build for production
npm run build
```

---

## 3. Production GSQL Schema & Query Artifact

See [`/tigergraph/veilpay_firewall.gsql`](./tigergraph/veilpay_firewall.gsql) for the complete TigerGraph 4.x schema (`Wallet`, `Merchant`, `ThreatEntity` vertices; `TRANSFERRED_TO`, `DUSTED` directed edges) and the 3-in-1 `veilpay_firewall_check` multi-hop traversal query using `OrAccum`, `MinAccum`, `SumAccum`, and `SetAccum`.
