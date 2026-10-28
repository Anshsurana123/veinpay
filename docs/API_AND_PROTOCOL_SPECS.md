# VeilPay — Verified 2026 API & Cryptographic Protocol Specifications

> **Verification Date:** 2026-10-28  
> All external endpoints, headers, query parameters, and JSON response paths in this file were verified against live 2026 documentation and live HTTP probes.

---

## 1. SOCKET (Bungee) Cross-Chain API Specification

### 1.1 Live Endpoint Status (Verified 2026-10-28)

| Endpoint | HTTP Status | Auth Required | Status / Notes |
| :--- | :--- | :--- | :--- |
| `https://public-backend.socket.tech/v3/swap/quote` | `200 OK` | **None** | **Primary Default.** Live Socket Swap V3 API for prototyping and public testing. |
| `https://dedicated-backend.socket.tech/v3/swap/quote` | `200 OK` | `x-api-key` + `affiliate` headers | Production V3 backend (20–100 RPS). Used automatically when `SOCKET_API_KEY` is set. |
| `https://api.socket.tech/v2/quote` | `401 Unauthorized` | `API-KEY` header | Legacy V2 endpoint (deprecated; requires legacy V2 key). |
| `https://public-backend.bungee.exchange/api/v1/bungee/quote` | `410 Gone` | — | Permanently retired (`"Bungee API has been deprecated, migrate to Socket V3 APIs"`). |

### 1.2 V2-to-V3 Query Parameter Mapping

Our internal endpoint `GET /api/socket/quote` accepts **both** the prompt's V2 query parameter names and Socket V3 query parameter names, translating them automatically when calling Socket Swap V3:

| Prompt (V2) Parameter | Socket Swap V3 Parameter | Example Value (Arbitrum USDC → Base USDC) | Description |
| :--- | :--- | :--- | :--- |
| — | `userOps` | `tx` | **Required in V3.** Requests executable transaction routes. |
| `fromChainId` | `originChainId` | `42161` (Arbitrum) | Source EVM chain ID. |
| `toChainId` | `destinationChainId` | `8453` (Base) | Destination EVM chain ID. |
| `fromTokenAddress` | `inputToken` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | Source token contract address (`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` for native ETH/POL). |
| `toTokenAddress` | `outputToken` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Destination token contract address. |
| `fromAmount` | `inputAmount` | `250000000` | Input amount in atomic base units (`250.00` USDC with 6 decimals). |
| `userAddress` | `userAddress` | `0x4F2a9c117034e8B1200499A1c3f88200000188E1` | Payer's connected wallet address. |
| `recipient` | `receiverAddress` | `0x742d35Cc6634C0532925a3b844Bc454e4438f44e` | Receiver's Cake Wallet EVM vault address. |
| `defaultBridgeSlippage` | `slippage` | `1` | Slippage tolerance percentage (e.g., `0.5` or `1`). |
| `uniqueRoutesPerBridge` / `sort` | *(Handled by V3 route ranking & `routeTags`)* | `["FASTEST", "MAX_OUTPUT", "SUGGESTED"]` | V3 ranks routes automatically; our adapter sorts by `output` or `estimatedTime` if `sort` is passed. |

### 1.3 Verified Socket V3 JSON Response Shape & V2 Compatibility Adapter

A live call to `GET https://public-backend.socket.tech/v3/swap/quote` (saved in [`docs/reference/socket-v3-quote-sample.json`](./reference/socket-v3-quote-sample.json)) returns:

```json
{
  "success": true,
  "statusCode": 200,
  "result": {
    "originChainId": 42161,
    "destinationChainId": 8453,
    "quoteType": "EXACT_INPUT",
    "userAddress": "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    "receiverAddress": "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    "input": {
      "token": { "chainId": 42161, "address": "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "symbol": "USDC", "decimals": 6 },
      "amount": "250000000",
      "valueInUsd": 250
    },
    "routes": [
      {
        "userOp": "tx",
        "quoteId": "0x226b741020d28c9ed574e3ce13115ca3f450dd79e7ed3c3622f3b521f922960c",
        "expiresAt": 1793190299,
        "output": {
          "token": { "chainId": 8453, "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "symbol": "USDC", "decimals": 6 },
          "amount": "249481388",
          "minAmountOut": "246986574",
          "valueInUsd": 249.481388
        },
        "estimatedTime": 3,
        "routeTags": ["FASTEST", "MAX_OUTPUT", "SUGGESTED"],
        "routeDetails": {
          "dexDetails": null,
          "bridgeDetails": {
            "protocol": {
              "name": "rfq-vault-executor",
              "displayName": "Socket Intents",
              "icon": "https://media.socket.tech/bridges/socket-icon.png"
            }
          }
        },
        "approval": {
          "spenderAddress": "0x50c4E75a512F2A14A7b304787Adf79C4531A5909",
          "amount": "250000000",
          "tokenAddress": "0xaf88d065e77c8cc2239327c5edb3a432268e5831"
        },
        "txData": {
          "kind": "evm_tx",
          "object": {
            "chainId": 42161,
            "to": "0x50c4E75a512F2A14A7b304787Adf79C4531A5909",
            "data": "0x2213bc0b...",
            "value": "0"
          }
        },
        "gasFee": {
          "estimatedFee": "10028000000000",
          "feeInUsd": 0.003
        },
        "statusCheck": {
          "endpoint": "https://public-backend.socket.tech/v3/swap/status?quoteId=0x226b...",
          "method": "GET",
          "intervalSec": 5
        }
      }
    ]
  }
}
```

#### Normalization Mapping in `/api/socket/quote`

Every route returned by `/api/socket/quote` is enriched so **both** V3 and V2 property paths resolve cleanly:

```typescript
const bridgeDisplayName =
  route.routeDetails?.bridgeDetails?.protocol?.displayName ??
  route.routeDetails?.bridgeDetails?.protocol?.name ??
  route.routeDetails?.dexDetails?.protocol?.displayName ??
  'Direct Verified Transfer';

const normalizedRoute = {
  ...route,
  // Brief V2 compatibility fields:
  toAmount: route.output.amount,
  usedBridgeNames: [bridgeDisplayName],
  serviceTime: route.estimatedTime,
  totalGasFeesInUsd: route.gasFee?.feeInUsd ?? 0,
};
```

### 1.4 Canonical Token & Chain Registry (`src/lib/socket/tokens.ts`)

| Chain | Chain ID | Native ETH/POL | USDC Address (6 dec) | USDT Address (6 dec) |
| :--- | :--- | :--- | :--- | :--- |
| **Ethereum** | `1` | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| **Arbitrum One** | `42161` | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` |
| **Base** | `8453` | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` |
| **Optimism** | `10` | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` |
| **Polygon** | `137` | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |

---

## 2. TigerGraph 4.x RESTPP & GSQL Specification

### 2.1 Token Generation (`POST /gsql/v1/tokens`)

In TigerGraph 4.x / Savanna, JWT Bearer tokens are requested from `/gsql/v1/tokens` using a GSQL secret:

```http
POST https://{TIGERGRAPH_HOST}/gsql/v1/tokens
Content-Type: application/json

{
  "secret": "<TIGERGRAPH_SECRET>",
  "graph": "VeilPayGraph",
  "lifetime": 604800000
}
```

### 2.2 Running the Installed Query (`GET/POST /restpp/query/{graph_name}/{query_name}`)

```http
POST https://{TIGERGRAPH_HOST}/restpp/query/VeilPayGraph/veilpay_firewall_check
Authorization: Bearer <TIGERGRAPH_TOKEN>
Content-Type: application/json

{
  "target_wallet": "0x99B1c402881a77e3d90123456789aB00000FDead",
  "merchant_wallet": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  "max_hops": 3
}
```

### 2.3 Standard TigerGraph RESTPP v2 Output Structure

Both the live TigerGraph RESTPP call and our in-process GSQL-mirror engine emit the exact TigerGraph RESTPP v2 JSON envelope (inspectable in the UI's **"Raw TigerGraph RESTPP JSON & GSQL"** drawer):

```json
{
  "version": { "edition": "enterprise", "api": "v2", "schema": 1 },
  "error": false,
  "message": "",
  "results": [
    {
      "verdict": "INTERCEPTED_TAINT",
      "target_wallet": "0x99B1c402881a77e3d90123456789aB00000FDead",
      "merchant_wallet": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      "max_hops_queried": 3,
      "min_taint_hop": 2,
      "taint_hits": 1,
      "sybil_cluster_size": 1,
      "sybil_root_funder": "",
      "cyclic_loop_detected": false,
      "dust_out_degree": 0,
      "nodes_scanned": 6,
      "edges_traversed": 5,
      "@@evidence_edges": [
        {
          "e_type": "TRANSFERRED_TO",
          "from_id": "0xdead000000000000000000000000000000000001",
          "from_type": "ThreatEntity",
          "to_id": "0x88E2a1004455667788990011223344556677A102",
          "to_type": "Wallet",
          "attributes": {
            "amount": 14.5,
            "amount_usd": 36250.0,
            "token": "ETH",
            "tx_hash": "0x88f1c9a0e4b2718293049586716253445566778899aabbccddeeff0011223301",
            "block_number": 21045890,
            "timestamp": "2026-10-28T11:14:22Z",
            "hop_distance": 2
          }
        }
      ]
    }
  ]
}
```

---

## 3. Etherscan V2 Multichain & GoPlus Live Threat-Intel Specification

### 3.1 Etherscan V2 Unified Endpoint (`https://api.etherscan.io/v2/api`)

```http
GET https://api.etherscan.io/v2/api?chainid={chainId}&module=account&action=txlist&address={address}&startblock=0&endblock=99999999&page=1&offset=25&sort=desc&apikey={ETHERSCAN_API_KEY}
```

### 3.2 Verified Etherscan V2 Free-Tier vs. Paid-Tier Chain Matrix (2026)

| Chain Name | `chainid` | Etherscan Free Tier Support | VeilPay Crawler Behavior |
| :--- | :--- | :--- | :--- |
| **Ethereum Mainnet** | `1` | **Supported (Free Tier)** | Full live N-hop crawl (`txlist` + `tokentx`). |
| **Arbitrum One** | `42161` | **Supported (Free Tier)** | Full live N-hop crawl (`txlist` + `tokentx`). |
| **Polygon Mainnet** | `137` | **Supported (Free Tier)** | Full live N-hop crawl (`txlist` + `tokentx`). |
| **Linea / Mantle / Blast / Taiko / Unichain / Sonic / Berachain / Monad** | `59144`, `5000`, etc. | **Supported (Free Tier — 90% of 60+ chains)** | Full live N-hop crawl. |
| **Base Mainnet** | `8453` | *Requires Paid Tier (Lite+)* | Crawler detects free-tier restriction on `8453`, automatically scans the wallet on Ethereum (`1`) + Arbitrum (`42161`) + Polygon (`137`), and badges the telemetry with `"Free-Tier Fallback: Scanned ETH/ARB/POL (Base 8453 requires Etherscan Lite)"`. |
| **OP Mainnet (Optimism)** | `10` | *Requires Paid Tier (Lite+)* | Same automatic multi-chain free-tier fallback + transparent badge. |

### 3.3 GoPlus Malicious Address API (Free, Keyless)

```http
GET https://api.gopluslabs.io/api/v1/address_security/{address}?chain_id={chainId}
```

Flags a discovered ancestor as a `ThreatEntity` if any of the following fields equal `"1"`:
- `stealing_attack` (`Drainer / Approval Exploit`)
- `phishing_activities` (`Phishing / Drainer`)
- `cybercrime` or `financial_crime` (`Exploit / Hack`)
- `money_laundering` or `mixer` (`Sanctioned Mixer / Laundering`)
- `sanctioned` (`OFAC / Sanctioned Entity`)
- `honeypot_related_address` or `malicious_mining_activities`

---

## 4. Cake Wallet URI & QR Code Specifications

### 4.1 Bitcoin Silent Payments (`sp1...` — BIP-352 & BIP-321)

- **Default Official BIP-352 Test-Vector Address:**
  ```text
  sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv
  ```
- **Primary QR / Deep-Link URI (BIP-321 Compliant `sp=` Parameter):**
  ```text
  bitcoin:?sp=sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv&amount=0.0025&label=VeilPay%20Protected%20Vault
  ```
- **Secondary Direct URI Copy Option (Prompt Legacy Format):**
  ```text
  bitcoin:sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv?amount=0.0025&label=VeilPay%20Protected%20Vault
  ```
- **Validation Rules (`src/lib/validators/address.ts`):**
  - Must start with `sp1q` (mainnet version 0) or `tsp1q` (testnet version 0).
  - Strict Bech32m charset check (`qpzry9x8gf2tvdw0s3jn54khce6mua7l` — rejects `'b'`, `'i'`, `'o'`, `'1'` in data part) and Bech32m polymod checksum verification (`0x2bc830a3`).

### 4.2 Monero Subaddress (`888...` — RingCT Private URI)

- **Default Subaddress:**
  ```text
  888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H
  ```
- **Spec-Compliant Monero URI:**
  ```text
  monero:888tNkZrPN6JsEgekjMnABU4TBzc2Dt29EPAvkRxbANsAnjyPbb3iQ1YBRk1UXcdRsiKc9dhwMVgN5S9cQUiyoogDavup3H?tx_amount=1.45&recipient_name=VeilPay%20Vault&tx_description=Audit%20Settlement
  ```
- **Validation Rules:**
  - Subaddress starts with `8` (or standard address with `4`), length `95` characters (or `106` for integrated address), all characters in Monero Base58 alphabet (`123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz` — excludes `0`, `O`, `I`, `l`).

---

## 5. Reown AppKit 1.8.x + Wagmi 3.x + Viem 2.x Setup Specification

- **Required Packages:**
  `@reown/appkit` (`^1.8.24`), `@reown/appkit-adapter-wagmi` (`^1.8.24`), `wagmi` (`^3.7.9`), `viem` (`^2.57.13`), `@tanstack/react-query` (`^5.105.0`).
- **How to Obtain Your Reown Project ID:**
  1. Go to [`https://dashboard.reown.com`](https://dashboard.reown.com) and sign in.
  2. Click **Create Project** and select **App** (AppKit) — *do NOT select Wallet (WalletKit)*.
  3. Copy the **Project ID** and set `NEXT_PUBLIC_PROJECT_ID=<your_id>` in `.env.local` and in Vercel Environment Variables.
  4. Under **Domain Whitelist / Allowed Origins**, add `http://localhost:3000` and your Vercel URL (`https://<your-project>.vercel.app`).
  5. If `NEXT_PUBLIC_PROJECT_ID` is not set during local development, VeilPay falls back to Reown's official localhost testing ID (`b56e18d47c72ab683b10814fe9495694`).
