# VeinPay — Master Agent Context & Execution Mandate (`AGENTS.md`)

> **READ THIS FIRST:** Every AI coding agent or engineer working in this repository MUST read this file and the linked documents in [`docs/`](./docs/) before modifying any code, configuration, or schema.

---

## 1. Project Identity & Core Architecture

**VeinPay** (built for Hacker House Goa) is a **Zero-Doxx Cross-Chain Payment Link & Pre-Sign Graph Firewall** for Web3. It unifies four sponsor/core technologies into a single pre-sign and settlement pipeline:

```text
[Payer Wallet (Reown AppKit / Persona Simulator / Custom Address)]
       │
       ▼
[1. TigerGraph 3-in-1 Pre-Flight Graph Firewall (<50ms)]
    ├── CleanLink:   1–5 Hop Backward Lineage Traversal (Drainers, Exploits, Sanctioned Mixers)
    ├── Unbundle:    Shared Root-Funder & Sybil Cluster / Cyclic Wash-Ring Detection
    └── PoisonGraph: Outbound Lookalike Prefix/Suffix Diff & Dust-Factory Out-Degree Check
       │
       ├──► IF BLOCKED (or Warned):
       │      • Render Interactive 2D Topological Subgraph + Contagion Path
       │      • Generate AIGI Deterministic Forensic Verdict & SHA-256 Compliance Receipt
       │      • Hard-Lock SOCKET Quote & Redact Native BTC/XMR Destination Vault URIs
       │
       └──► IF CLEAN (or Policy Bypassed with Advisory):
              • Unlock SOCKET Swap V3 API (/v3/swap/quote & /v3/swap/status)
              • Unlock Cake Wallet Default Destination Vault Settlement
                ├── Mode 1: Multi-Chain EVM (Auto-Bridged via SOCKET to Cake Wallet)
                ├── Mode 2: Bitcoin Silent Payments (BIP-352 sp1... via BIP-321 QR/URI)
                └── Mode 3: Monero Subaddress (RingCT 888... via monero: QR/URI)
```

---

## 2. Workspace Documentation Map

Before writing or changing code, consult the corresponding specification file:

| File | Purpose |
| :--- | :--- |
| [`AGENTS.md`](./AGENTS.md) / [`CLAUDE.md`](./CLAUDE.md) | Master rules, locked user decisions, environment variables, and verification loop. |
| [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) | Phased engineering plan, file tree, module responsibilities, and build sequence. |
| [`docs/ARCHITECTURE_AND_DECISIONS.md`](./docs/ARCHITECTURE_AND_DECISIONS.md) | Exhaustive Architecture Decision Records (ADRs) and trade-off analysis for all 16 technical choices ("every outcome of choosing one option over another"). |
| [`docs/API_AND_PROTOCOL_SPECS.md`](./docs/API_AND_PROTOCOL_SPECS.md) | Verified 2026 API contracts: SOCKET V3 (`/v3/swap/quote`), TigerGraph 4.x RESTPP, Etherscan V2 multichain crawler, GoPlus + ScamSniffer + OFAC threat feeds, BIP-352/BIP-321 & Monero URIs, and Reown AppKit SSR config. |
| [`docs/DESIGN_SYSTEM.md`](./docs/DESIGN_SYSTEM.md) | Warm Carbon / Burnished Copper / Botanical Jade design tokens, Tailwind v4 `@theme` setup, typography, and strict anti-slop / zero-purple rules. |
| [`docs/EDGE_CASES_AND_TEST_MATRIX.md`](./docs/EDGE_CASES_AND_TEST_MATRIX.md) | Canonical EIP-55 & BIP-352 persona addresses, hop-depth 1–5 truth tables, cycle prevention, PoisonGraph character-diff math, and Vitest test cases. |
| [`docs/reference/socket-v3-quote-sample.json`](./docs/reference/socket-v3-quote-sample.json) | Live captured 50 KB JSON response from `https://public-backend.socket.tech/v3/swap/quote` (Arbitrum USDC → Base USDC) used for schema verification and offline fallback realism. |
| [`.agents/skills/appkit/SKILL.md`](./.agents/skills/appkit/SKILL.md) | Official Reown AppKit skill & Next.js Wagmi SSR reference ([`nextjs-wagmi.md`](./.agents/skills/appkit/references/nextjs-wagmi.md)). |

---

## 3. Locked Architectural Decisions (User-Confirmed)

All architectural ambiguities were resolved with the project owner and are **locked**:

1. **SOCKET Integration (V3 Live + V2 Adapter + 3500ms Offline Fallback):**
   - Legacy `api.socket.tech/v2/quote` (401 without legacy key) and `public-backend.bungee.exchange` (410 Gone) are deprecated as of 2026.
   - Our backend `/api/socket/quote` calls **Socket Swap V3** (`GET https://public-backend.socket.tech/v3/swap/quote?userOps=tx&...`) by default (zero auth required), or `https://dedicated-backend.socket.tech/v3/swap/quote` when `SOCKET_API_KEY` + `SOCKET_AFFILIATE_ID` are set.
   - Our adapter normalizes the V3 response into a unified `VeinPayQuoteResult` that exposes **both** native V3 fields (`routes[0].output.amount`, `routes[0].routeDetails.bridgeDetails.protocol.displayName`, `routes[0].estimatedTime`, `routes[0].gasFee.feeInUsd`, `routes[0].txData.object`, `routes[0].approval`) **and** the brief's v2-compatible alias paths (`result.routes[0].toAmount`, `usedBridgeNames`, `serviceTime`, `totalGasFeesInUsd`).
   - Enforces an `AbortSignal.timeout(3500)` abort controller. On network drop or rate limit, returns a realistic, deterministic fallback route quote clearly badged `FALLBACK_DETERMINISTIC`.
2. **TigerGraph Engine (Hybrid In-Process GSQL-Mirror + Live TigerGraph 4.x RESTPP):**
   - Primary engine is a real, cycle-safe, multi-hop directed graph traversal engine in TypeScript (`src/lib/graph/engine.ts`) using GSQL-equivalent accumulators (`OrAccum`, `MinAccum`, `SumAccum`, `SetAccum`).
   - When `TIGERGRAPH_HOST`, `TIGERGRAPH_GRAPH`, and `TIGERGRAPH_TOKEN` (or `TIGERGRAPH_SECRET` via `POST /gsql/v1/tokens`) are configured, `/api/firewall/scan` executes against live TigerGraph 4.x RESTPP (`POST /restpp/query/{graph}/veinpay_firewall_check`) and falls back to the in-process engine if unreachable.
   - Production GSQL schema and query artifact lives at `/tigergraph/veinpay_firewall.gsql`.
3. **Honest Telemetry Timing:**
   - Only real measured `performance.now()` execution durations (`executionTimeMs`) are reported, explicitly labeled by execution source (`IN_MEMORY_GSQL_ENGINE` vs `TIGERGRAPH_RESTPP_LIVE` vs `ETHERSCAN_V2_LIVE_CRAWL`). No fake static numbers.
4. **AIGI Forensic Agent (Deterministic Core + Optional Gemini Structured Narration):**
   - The core verdict (`VERIFIED_CLEAN`, `INTERCEPTED_TAINT`, `INTERCEPTED_SYBIL`, `WARNING_SYBIL`, `INTERCEPTED_POISONING`, `ADVISORY_BYPASSED`), hop-by-hop evidence chain, and **SHA-256 Cryptographic Audit Hash** (Web Crypto `crypto.subtle.digest('SHA-256', canonicalJson)`) are 100% deterministic.
   - If `GEMINI_API_KEY` is present, `@google/genai` may optionally generate an executive human-readable summary strictly constrained to the cited evidence edges, without ever altering the deterministic verdict or SHA-256 hash.
5. **Wallet Connection (Reown AppKit 1.8.x + Wagmi 3.x + Viem 2.x) & Mainnet Safety Cap:**
   - Uses `@reown/appkit` + `@reown/appkit-adapter-wagmi` with Next.js SSR cookie hydration (`ssr: true`, `cookieToInitialState`).
   - Requires a Reown **App** Project ID (`NEXT_PUBLIC_PROJECT_ID`) from `https://dashboard.reown.com` (defaults to Reown's official localhost testing ID `b56e18d47c72ab683b10814fe9495694` in local dev).
   - Real mainnet transactions from SOCKET `txData.object` are allowed **only** after passing the firewall AND passing a confirmation modal with a configurable per-transaction USD safety cap (`NEXT_PUBLIC_MAX_MAINNET_USD=5`, adjustable in Settings).
6. **Live Custom-Address Crawling (Etherscan V2 Multichain API + Bundled Snapshot + GoPlus Live):**
   - When a user scans a custom EVM address not in the seeded demo graph and `ETHERSCAN_API_KEY` is configured, the backend crawls real N-hop inbound funding history via Etherscan API V2 (`https://api.etherscan.io/v2/api?chainid={id}`) and checks each discovered ancestor against our bundled **ScamSniffer + OFAC + Exploit snapshot** (`src/data/threat-intel-snapshot.json`) plus live **GoPlus Address Security API** (`https://api.gopluslabs.io/api/v1/address_security/{addr}`).
   - Default crawl budget: top `5` inbound funders per vertex (excluding dust `<= 0.0001`), max `40` API calls/scan, `3 req/s` token-bucket rate limiter, `10s` timeout budget, LRU cache, and user-adjustable sliders in the Settings drawer.
   - Free-tier Etherscan V2 supports Ethereum (`1`), Arbitrum (`42161`), Polygon (`137`), Linea (`59144`), Mantle (`5000`), etc. (90% of 60+ chains), while Base (`8453`) and Optimism (`10`) require a paid Etherscan plan. Our crawler automatically detects chain tier support and surfaces a transparent tier badge if a paid-only chain is queried on a free key.
7. **Unbundle Sybil Policy & Master Firewall Toggle:**
   - Hop depth selector supports **`1` to `5` hops** (default `3 Hops`).
   - Unbundle sybil detection blocks (`INTERCEPTED_SYBIL`) when `sybil_cluster_size >= sybilBlockThreshold` (default `10`), and warns in Ochre Amber (`WARNING_SYBIL`) for smaller clusters (`3..9`).
   - When the Master Firewall Toggle is switched **OFF**, the traversal still runs so the judge sees the topological threat in the graph as `ADVISORY_BYPASSED`, while unlocking SOCKET quote fetching to prove the toggle dynamically governs enforcement.
8. **Native BTC Silent Payments (`sp1...`) & Monero (`888...`) Firewall Gate:**
   - For BTC/XMR vault settlement modes, the payer connects/selects their wallet first; the Cake Wallet QR code and `bitcoin:?sp=...` / `monero:...` URIs remain **redacted/locked** until the TigerGraph firewall clears the payer.
   - Provides both **BIP-321 standard URI** (`bitcoin:?sp=sp1...&amount=...&label=...`) and a legacy copy toggle (`bitcoin:sp1...?amount=...&label=...`).
9. **Routing & Shareable Links:**
   - Primary workspace `/` renders the **Receiver Command Center** and **Live Payer Checkout Simulator** side-by-side (or split view) backed by a shared Zustand store (`src/store/veinpay-store.ts`), including an **Incoming Payment Feed** tab, **Safe Send Outbound Guard** tab, and **Crawl/Safety Settings** drawer.
   - Standalone `/pay/[handle]?c=<base64url>` route reconstructs any generated link statelessly on both `localhost:3000` and Vercel production deployments (`window.location.origin`), while displaying the branded `veinpay.xyz/pay/<handle>` handle pill.

---

## 4. Zero-Tolerance Engineering Rules

1. **NO INCOMPLETE CODE, STUBS, OR PLACEHOLDERS:**
   - Never write `// TODO`, `// implement later`, `// mock data here`, `pass`, or `return true; // placeholder`.
2. **NO FAKE STATIC BOOLEANS PRETENDING TO BE ALGORITHMS:**
   - Never hardcode `if (address === '0x99B1...') return blocked`. Every verdict MUST come from executing the directed graph traversal engine over vertex/edge adjacency lists at the active `max_hops` (`1..5`) and engine toggles (`CleanLink`, `Unbundle`, `PoisonGraph`).
3. **ZERO PURPLE / INDIGO / AI SLOP:**
   - Strictly forbidden anywhere in `src/`: `purple-`, `indigo-`, `violet-`, `fuchsia-`, `#6366f1`, `#8b5cf6`.
   - Use the **Institutional Hardware / Financial Terminal** palette defined in [`docs/DESIGN_SYSTEM.md`](./docs/DESIGN_SYSTEM.md): Deep Warm Carbon (`#0B0C0E`), Rich Graphite (`#131519`), Interactive Slate (`#1A1D23`), Hairline Border (`#262A33`), Warm Alabaster (`#F3F1EC`), Warm Pewter (`#9499A3`), Burnished Copper (`#D97736`), Bullion Gold (`#E5A93C`), Botanical Jade (`#1F9D68`), Ochre Amber (`#D99B26`), and Oxide Vermilion (`#D6453A`).
4. **SPEC-VALID ADDRESSES ONLY:**
   - Every seeded EVM address must pass strict EIP-55 checksum validation (`viem` `isAddress(addr, { strict: true })`).
   - Every seeded Bitcoin Silent Payment address must be a valid Bech32m `sp1...` address from official BIP-352 test vectors.
   - Every seeded Monero subaddress must be a valid 95-character Base58 `8...` subaddress.

---

## 5. Mandatory Verification Loop Before Completion

Before declaring any implementation task complete, run and pass all five checks:

```powershell
# 1. Zero-Purple Audit (must return 0 matches)
Select-String -Path "src\**\*" -Pattern "purple|indigo|violet|fuchsia|6366f1|8b5cf6" -CaseSensitive:$false

# 2. TypeScript Strict Check
npx tsc --noEmit

# 3. Vitest Algorithmic Unit & Edge-Case Suite
npm run test -- --run

# 4. Production Next.js Build
npm run build

# 5. Live API Smoke Tests (with dev server on http://localhost:3000)
# Test /api/firewall/scan (hop=1 vs hop=3 vs hop=4), /api/aigi/verdict, /api/socket/quote, /api/firewall/poison
```

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
