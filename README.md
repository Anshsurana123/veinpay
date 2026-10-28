# VeilPay — Zero-Doxx Cross-Chain Payment Link & Pre-Sign Graph Firewall

> **Built for Hacker House Goa**  
> **VeilPay** is a privacy-first cross-chain payment link platform and pre-sign graph firewall for Web3. It lets freelancers, merchants, DAO contributors, and grants recipients get paid in any token across chains—settling into a **Cake Wallet** privacy vault—while automatically blocking tainted drainer funds, Sybil wash-rings, and lookalike address-poisoning attacks **before** a transaction is ever signed.

---

## Table of Contents

1. [What Problem Does VeilPay Solve?](#1-what-problem-does-veilpay-solve)
2. [How VeilPay Works (The 4 Core Pillars)](#2-how-veilpay-works-the-4-core-pillars)
3. [Mainnet & Testnet Support (`[ MAINNET | TESTNET ]`)](#3-mainnet--testnet-support--mainnet--testnet-)
4. [Interactive 2-Minute Demo Walkthrough](#4-interactive-2-minute-demo-walkthrough)
5. [Quick Start & Local Installation](#5-quick-start--local-installation)
6. [Environment Variables (`.env.local`)](#6-environment-variables-envlocal)
7. [Project Structure & Documentation Map](#7-project-structure--documentation-map)
8. [Verification & Test Suite](#8-verification--test-suite)

---

## 1. What Problem Does VeilPay Solve?

Today, getting paid in Web3 (or sending a payment) exposes both parties to **three critical risks**:

1. **Receiver Doxxing:** Sharing a raw `0x...` or `.eth` address on an invoice exposes your entire historical net worth, token balances, and counterparty graph to everyone who clicks the link.
2. **Incoming Taint Contagion (Compliance Freeze Risk):** If a payer sends you funds that passed through an exploit, wallet drainer, or OFAC-sanctioned mixer 2–4 hops ago, centralized exchanges and compliance engines automatically freeze **your** receiving wallet by association.
3. **Outbound Address Poisoning:** Attackers use GPU vanity generators to create fake addresses matching the first 4 and last 4 characters of your frequent contacts (`0x71C9...89A2`), drop zero-value dust into your history, and wait for you to copy-paste the wrong address from your transaction log.

### The VeilPay Solution

VeilPay puts a **sub-50ms TigerGraph Pre-Sign Firewall** and **AIGI Forensic Compliance Agent** directly in front of **SOCKET Cross-Chain Routing** and **Cake Wallet Stealth Vaults**:

- **Payers** connect or select their wallet on a clean checkout link (`veilpay.xyz/pay/ansh-audit`).
- **Before any quote or vault address is revealed**, VeilPay traverses 1 to 5 hops of the payer's transaction graph.
- **If the payer is tainted**, VeilPay hard-locks the checkout, highlights the exact contagion path on an interactive 2D graph, and issues a **Blocked Forensic Receipt**.
- **If the payer is verified clean**, VeilPay unlocks **SOCKET Swap V3** cross-chain routing and **Cake Wallet** destination vaults (Multi-Chain EVM, Bitcoin Silent Payments `sp1...` / `tsp1...`, or Monero `888...` subaddresses), generating a **SHA-256 Cryptographic Compliance Receipt** so the receiver can prove their incoming funds were pre-screened.

---

## 2. How VeilPay Works (The 4 Core Pillars)

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
              • Unlock SOCKET Swap V3 Cross-Chain Quote & Bridge Calldata
              • Unlock Cake Wallet Default Destination Vault Settlement
                ├── Mode 1: Multi-Chain EVM (Auto-Bridged via SOCKET to Cake Wallet)
                ├── Mode 2: Bitcoin Silent Payments (BIP-352 sp1... / tsp1... via BIP-321 QR/URI)
                └── Mode 3: Monero Subaddress (RingCT 888... via monero: QR/URI)
```

### Pillar 1: TigerGraph 3-in-1 Pre-Sign Graph Firewall
Implemented both as a production GSQL query ([`/tigergraph/veilpay_firewall.gsql`](./tigergraph/veilpay_firewall.gsql)) and a cycle-safe, in-process TypeScript graph engine ([`src/lib/graph/engine.ts`](./src/lib/graph/engine.ts)) using GSQL-equivalent accumulators (`OrAccum`, `MinAccum`, `SumAccum`, `SetAccum`):
- **`CleanLink` (Upstream Taint Traversal):** Walks `1` to `5` hops backward along inbound funding edges to detect drainer contracts (`PinkDrainer`, `Inferno Drainer`), protocol exploits (`Bybit Lazarus`), and OFAC-sanctioned mixers (`Tornado Cash Router`).
- **`Unbundle` (Sybil & Wash-Ring Collapse):** Detects when seemingly independent wallets trace back to a single shared root funder (e.g., a 24-wallet Sybil distributor) or trade in a cyclic wash loop (`Mule_A -> Mule_B -> Mule_C -> Mule_A`).
- **`PoisonGraph` (Vanity Address-Poisoning Guard):** Compares all 42 characters of an outbound recipient address against known safe contacts, flagging identical prefix/suffix lookalikes (`0x71C9...89A2`) and high-out-degree dust factories (`out_degree >= 500`).

### Pillar 2: AIGI Forensic Agent & Compliance Receipt
- Consumes the raw subgraph telemetry (`hop_distance`, `taint_hits`, `sybil_cluster_size`, `evidence_edges`) and produces a **100% deterministic Forensic Security Verdict** (`VERIFIED_CLEAN`, `INTERCEPTED_TAINT`, `INTERCEPTED_SYBIL`, `WARNING_SYBIL`, `INTERCEPTED_POISONING`, or `ADVISORY_BYPASSED`).
- Computes a tamper-evident **SHA-256 Cryptographic Audit Hash** over the canonical receipt payload using the Web Crypto API (`crypto.subtle.digest`).
- Optionally pairs with **Google Gemini (`gemini-2.5-flash`)** to generate a concise human-readable executive summary strictly constrained to the cited graph edges—without ever altering the deterministic verdict or SHA-256 hash.

### Pillar 3: SOCKET (Bungee Swap V3) Cross-Chain Routing
- Strictly gated behind firewall clearance (`socketUnlocked === true`).
- Queries live **SOCKET Swap V3** (`https://public-backend.socket.tech/v3/swap/quote`) on Mainnet and builds executable ERC-20 / Native ETH bridge routes on Testnet, returning real router calldata (`txData.object`), bridge protocol names (`Across`, `Stargate`, `CCTP`), estimated settlement time, and gas fees in USD.
- Includes a 3,500ms timeout guard with a deterministic offline fallback so live demos never hang on unstable venue Wi-Fi.

### Pillar 4: Cake Wallet Zero-Doxx Destination Vaults
Every VeilPay link settles into **Cake Wallet** across three selectable privacy modes:
1. **Mode 1 — Multi-Chain EVM (via SOCKET):** Payer pays from any supported EVM chain/token; SOCKET bridges and settles directly into the receiver's Cake Wallet EVM vault.
2. **Mode 2 — Bitcoin Silent Payments (`BIP-352` / `BIP-321`):** Uses non-reusable `sp1...` (Mainnet) or `tsp1...` (Testnet) Silent Payment addresses so every payment derives a unique one-time Taproot output on-chain with zero address reuse. Supports both `BIP-321` (`bitcoin:?sp=sp1...`) and legacy (`bitcoin:sp1...`) QR codes/URIs.
3. **Mode 3 — Monero Stealth Subaddress (`888...` RingCT):** Generates a spec-compliant `monero:888...?tx_amount=...&recipient_name=...` QR code and deep-link—kept redacted until the payer passes the pre-sign firewall.

---

## 3. Mainnet & Testnet Support (`[ MAINNET | TESTNET ]`)

VeilPay supports both **Mainnet** and **Testnet** workflows out of the box. You can switch the entire application between Mainnet and Testnet at any time using the **`[ MAINNET | TESTNET ]`** toggle button in the top telemetry bar.

### Supported Networks Matrix

| Network | Environment | Chain ID / Prefix | Supported Assets | Explorer & Faucet Support |
| :--- | :--- | :--- | :--- | :--- |
| **Base** | Mainnet | `8453` | `USDC`, `USDT`, `ETH` | `basescan.org` (SOCKET V3 Live) |
| **Arbitrum One** | Mainnet | `42161` | `USDC`, `USDT`, `ETH` | `arbiscan.io` (SOCKET V3 Live + Etherscan V2 Crawl) |
| **Ethereum** | Mainnet | `1` | `USDC`, `USDT`, `ETH` | `etherscan.io` (SOCKET V3 Live + Etherscan V2 Crawl) |
| **Optimism** | Mainnet | `10` | `USDC`, `USDT`, `ETH` | `optimistic.etherscan.io` (SOCKET V3 Live) |
| **Polygon PoS** | Mainnet | `137` | `USDC`, `USDT`, `ETH` | `polygonscan.com` (SOCKET V3 Live + Etherscan V2 Crawl) |
| **Base Sepolia** | **Testnet** | `84532` | `USDC`, `USDT`, `ETH` | `sepolia.basescan.org` + [Circle USDC Faucet](https://faucet.circle.com/) |
| **Arbitrum Sepolia** | **Testnet** | `421614` | `USDC`, `USDT`, `ETH` | `sepolia.arbiscan.io` + [Circle USDC Faucet](https://faucet.circle.com/) |
| **Ethereum Sepolia** | **Testnet** | `11155111` | `USDC`, `USDT`, `ETH` | `sepolia.etherscan.io` + [Circle USDC Faucet](https://faucet.circle.com/) |
| **OP Sepolia** | **Testnet** | `11155420` | `USDC`, `USDT`, `ETH` | `sepolia-optimism.etherscan.io` + [Circle USDC Faucet](https://faucet.circle.com/) |
| **Polygon Amoy** | **Testnet** | `80002` | `USDC`, `USDT`, `ETH` | `amoy.polygonscan.com` + [Polygon Faucet](https://faucet.polygon.technology/) |
| **Bitcoin Silent Payments** | Mainnet & Testnet | `sp1q...` / `tsp1q...` | `BTC` (BIP-352) | Official BIP-352 Mainnet (`sp1`) & Testnet (`tsp1`) vectors |
| **Monero Subaddress** | Mainnet / Stagenet | `888...` (95-char Base58) | `XMR` (RingCT) | Cake Wallet `monero:` URI & QR deep-link |

### How to Test Real On-Chain Transactions on Testnet
1. Click **`TESTNET`** in the `[ MAINNET | TESTNET ]` toggle in the top header bar.
   - The destination chain automatically switches to **Base Sepolia (`84532`)**, the payer source chain switches to **Arbitrum Sepolia (`421614`)**, and the Bitcoin Silent Payment vault switches to a BIP-352 Testnet address (`tsp1qqgste7k9...`).
2. Need Testnet tokens? Click the **`GET FREE TESTNET USDC (CIRCLE FAUCET) ↗`** button in the Payer Checkout banner (or visit [https://faucet.circle.com/](https://faucet.circle.com/)).
3. Click **`Connect Wallet`** in the top-right corner (powered by **Reown AppKit + Wagmi**) and connect MetaMask, Rabby, Rainbow, or any WalletConnect wallet on a Sepolia/Amoy testnet.
4. Select **Persona 1 (Verified Clean)** (or scan your own wallet address) so the TigerGraph firewall clears the payment.
5. Click **`EXECUTE SETTLEMENT VIA CAKE WALLET VAULT`** to open the settlement modal, then click **`SIGN & BROADCAST ON ARBITRUM SEPOLIA`** to sign the real transaction in your wallet and view the live transaction link on the Sepolia block explorer!

---

## 4. Interactive 2-Minute Demo Walkthrough

You don't even need a wallet extension installed to test every graph algorithm and edge case—VeilPay includes a **4-Persona Payer Simulator** and **Safe Send Guard** right on the main screen:

### Step 1: Test a Clean Cross-Chain Payment (`Persona 1: Verified Clean`)
- Click **`Persona 1: Verified Clean`** (`0x4F9A...21E4`) in the right-hand Payer Checkout Simulator.
- **What happens:** The TigerGraph engine traverses 2 hops back to an institutional treasury (`Coinbase Prime`), finds `0` threats, renders a green **Botanical Jade** subgraph, generates a `VERIFIED_CLEAN` AIGI receipt with a SHA-256 hash, and unlocks the **SOCKET Swap V3** quote and **Cake Wallet Settlement Modal**.

### Step 2: Prove Real Dynamic Hop-Depth Traversal (`Persona 2: Drainer Taint at Hop 2`)
- Click **`Persona 2: Hop-2 Taint`** (`0x99B1...C408`).
- With the default **`3 Hops`** selected on the left panel:
  - The traversal reaches `Hop 2` (`PinkDrainer: Root Vault 0x6666...6666`), triggers **`INTERCEPTED_TAINT`**, highlights the red contagion path on the 2D canvas, and **hard-locks** SOCKET and Cake Wallet settlement.
- Now click **`1 Hop`** in the **Max Hop Traversal Depth** selector on the left panel:
  - The exact same graph traversal genuinely stops at `Hop 1` (`Intermediate Mule 0xB2A1...`), returns **`VERIFIED_CLEAN`** with a yellow **Shallow Scan Advisory Banner**, and unlocks SOCKET! Switching back to **`2 Hops`** or **`3 Hops`** immediately re-catches the drainer.

### Step 3: Catch a 24-Wallet Sybil Cluster & Cyclic Wash Loop (`Persona 3: Sybil Bundle`)
- Click **`Persona 3: Sybil Bundle`** (`0x7C2D...9A10`).
- **What happens:** The `Unbundle` engine detects that this wallet is part of a **24-wallet Sybil cluster** funded by a single root distributor (`0xD157...F00D`) AND traverses a 3-node cyclic wash loop (`Mule_A -> Mule_B -> Mule_C -> Mule_A`) without infinite recursion (`cyclesDetected: 1`), blocking the checkout with **`INTERCEPTED_SYBIL`**.

### Step 4: Catch a 4-Hop Deep Lazarus Exploit Chain (`Persona 4: 4-Hop Deep Taint`)
- Click **`Persona 4: 4-Hop Deep Taint`** (`0xE310...88B2`).
- At `3 Hops`, this wallet passes (`VERIFIED_CLEAN`) because the exploit source is 4 hops away.
- Switch the depth selector to **`4 Hops`** or **`5 Hops`**: The firewall reaches `Hop 4` (`Bybit Exploit: Lazarus Group`), immediately flipping the verdict to **`INTERCEPTED_TAINT`**.

### Step 5: Stop an Outbound Address-Poisoning Attack (`Tab 2: Safe Send Outbound Guard`)
- Click **`02 // SAFE SEND OUTBOUND GUARD (POISONGRAPH)`** in the workspace tab bar.
- Click the red preset **`Scenario A: Lookalike Dust Poisoner (0x71C9...89A2)`**.
- **What happens:** `PoisonGraph` compares all 42 characters against your verified contact (`Alice Maker`), highlights the **6 matching prefix characters** (`0x71C9`) and **4 matching suffix characters** (`89A2`) alongside the **32 forged middle characters**, flags the attacker's `1,420` dust out-degree, and gives you a **1-click `"AUTO-REPLACE WITH VERIFIED CONTACT"`** recovery button.

---

## 5. Quick Start & Local Installation

### Prerequisites
- **Node.js** `>= 20.x`
- **npm** `>= 10.x`

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Anshsurana123/veinpay.git
cd veinpay
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local` (the app works out-of-the-box even with zero API keys thanks to the built-in GSQL-mirror graph engine, public SOCKET Swap V3 endpoint, and Reown localhost project ID):

```bash
cp .env.example .env.local
```

### 3. Start the Development Server

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 6. Environment Variables (`.env.local`)

| Variable | Required? | Purpose |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_PROJECT_ID` | Recommended | Reown AppKit Project ID from [dashboard.reown.com](https://dashboard.reown.com) for WalletConnect / MetaMask connection. Falls back to Reown's official localhost test ID in dev. |
| `NEXT_PUBLIC_MAX_MAINNET_USD` | Optional | Default per-transaction USD safety cap on Mainnet (defaults to `5`). Adjustable live in the UI Settings drawer. |
| `ETHERSCAN_API_KEY` | Optional | Enables live N-hop inbound wallet crawling via Etherscan API V2 (`https://api.etherscan.io/v2/api`) across 60+ Mainnet & Testnet chains when scanning custom addresses. |
| `GEMINI_API_KEY` | Optional | Enables optional `@google/genai` (`gemini-2.5-flash`) executive narration on top of the deterministic AIGI receipt. |
| `SOCKET_API_KEY` | Optional | Optional dedicated SOCKET key (`public-backend.socket.tech/v3/swap/quote` works without a key). |
| `TIGERGRAPH_HOST` / `TIGERGRAPH_GRAPH` / `TIGERGRAPH_TOKEN` | Optional | Connects `/api/firewall/scan` to a live TigerGraph 4.x RESTPP cluster (`POST /restpp/query/{graph}/veilpay_firewall_check`). Automatically falls back to the in-process TypeScript GSQL engine when unset. |

---

## 7. Project Structure & Documentation Map

```text
├── tigergraph/
│   └── veilpay_firewall.gsql          # Production TigerGraph 4.x Schema & 3-in-1 GSQL Query
├── docs/
│   ├── ARCHITECTURE_AND_DECISIONS.md  # 16 Architecture Decision Records (ADRs) & trade-off matrices
│   ├── API_AND_PROTOCOL_SPECS.md      # Verified 2026 API contracts (SOCKET V3, TigerGraph, BIP-352)
│   ├── DESIGN_SYSTEM.md               # Institutional Hardware / Financial Terminal design system
│   └── EDGE_CASES_AND_TEST_MATRIX.md  # Hop-depth 1–5 truth tables & EIP-55 / BIP-352 test vectors
├── src/
│   ├── app/
│   │   ├── page.tsx                   # Split-Screen Receiver Command Center + Live Payer Simulator
│   │   ├── pay/[handle]/page.tsx      # Shareable Stateless Checkout Route (/pay/ansh-audit?c=...)
│   │   └── api/
│   │       ├── firewall/scan/         # POST /api/firewall/scan (CleanLink + Unbundle + Live Crawl)
│   │       ├── firewall/poison/       # POST /api/firewall/poison (42-char PoisonGraph diff)
│   │       ├── aigi/verdict/          # POST /api/aigi/verdict (Deterministic SHA-256 + Gemini)
│   │       └── socket/quote/          # GET  /api/socket/quote (SOCKET Swap V3 + Testnet Router)
│   ├── components/                    # All Institutional Terminal UI Panels, 2D Graph Canvas & Modals
│   ├── lib/
│   │   ├── graph/                     # Multi-Hop BFS Engine, Seed Topologies, Live Etherscan Crawler
│   │   ├── aigi/                      # Deterministic Verdict Builder, Canonical SHA-256, Gemini Agent
│   │   ├── socket/                    # SOCKET Swap V3 Client, Mainnet/Testnet Chain & Token Registry
│   │   └── validators/                # Strict EIP-55, BIP-352 (sp1/tsp1), BIP-321 & Monero Validators
│   └── store/
│       └── veilpay-store.ts           # Unified Zustand Store (Mainnet/Testnet, Policy, Feed, Settings)
```

---

## 8. Verification & Test Suite

Run all four verification checks at any time:

```bash
# 1. TypeScript Strict Typecheck (0 errors)
npm run typecheck

# 2. Vitest Algorithmic Unit & Edge-Case Suite (14/14 passing tests)
npm run test:run

# 3. Production Next.js App Router Build
npm run build

# 4. Refresh Bundled Threat-Intel Snapshot (OFAC + ScamSniffer + Exploits)
npm run refresh:threats
```
