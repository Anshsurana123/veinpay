# VeilPay — Calm, Task-Focused Financial Security Design System

> **CRITICAL RULE:** Purple, indigo, violet, lavender, or magenta colors (`#6366F1`, `#8B5CF6`, `purple-*`, `indigo-*`, `violet-*`) are **STRICTLY BANNED** across the entire repository.

---

## 1. Aesthetic Philosophy: Calm, Plain-Language & Task-Focused

VeilPay's redesign transitions away from dense, all-caps monospace screens to a **calm, human, task-focused financial security interface**:
- **Plain Language Over Jargon:** Instead of raw enum codes, the UI presents human sentences ("Your wallet is clear to pay", "This payment is blocked: linked wallet group", "Paying ansh-audit").
- **Task Hierarchy:** Single-focus layout with top tabs (`Pay`, `Create link`, `Activity`, `Safe send`), removing cluttered split-screens.
- **Organic Typography:** Fraunces (soft, editorial display serif) for logos, titles, and amounts paired with DM Sans for readable, accessible interface copy.

---

## 2. Locked Color Token System

| Semantic Token | Hex Code | CSS Custom Property | Usage |
| :--- | :--- | :--- | :--- |
| **Canvas Background** | `#0F1A21` | `--bg` | Deep slate canvas with a subtle radial top glow (`#1a3040`). |
| **Surface Card** | `#16252F` | `--s` | Primary surface container background (cards, sheets, inputs). |
| **Raised Interactive** | `#1C2F3B` | `--r` | Hover states, active segmented buttons, secondary buttons. |
| **Line & Hairline Border** | `#27404F` | `--l` | Structural dividers, card borders, progress ticks. |
| **Text Primary** | `#EAF0F3` | `--t` | High-contrast alabaster copy for headings and primary content. |
| **Text Muted** | `#8EA5B4` | `--m` | Subtitles, labels, currency tags, and timestamps. |
| **Ivory Action** | `#EFE6D2` | `--iv` | Warm ivory for primary action buttons, active pills, and brand badges. |
| **Dark Ink** | `#14212A` | `--ink` | High-contrast dark text inside ivory buttons and badges. |
| **Status Cleared (Mint)** | `#7FD6B0` | `--ok` | Verified clean wallets, successful settlements, active links. |
| **Status Blocked (Coral)** | `#F28B7B` | `--bad` | Intercepted drainers, sybil rings, address poisoning alerts. |
| **Status Caution (Amber)** | `#E8C06A` | `--wn` | Sybil warning advisories, testnet sandbox banners, inconclusive notes. |

---

## 3. Tailwind CSS v4 Configuration (`src/app/globals.css`)

```css
@import "tailwindcss";

@theme {
  --color-canvas: #0f1a21;
  --color-surface: #16252f;
  --color-raised: #1c2f3b;
  --color-line: #27404f;
  --color-text-main: #eaf0f3;
  --color-text-muted: #8ea5b4;
  --color-ivory: #efe6d2;
  --color-ink: #14212a;
  --color-mint: #7fd6b0;
  --color-coral: #f28b7b;
  --color-amber: #e8c06a;

  --font-serif: var(--font-serif), 'Fraunces', Georgia, serif;
  --font-sans: var(--font-sans), 'DM Sans', system-ui, sans-serif;
  --font-mono: var(--font-mono), ui-monospace, SFMono-Regular, monospace;
}
```
  --color-jade-bg: #0E291E;

  --color-ochre: #D99B26;
  --color-ochre-bg: #2B210D;

  --color-vermilion: #D6453A;
  --color-vermilion-bg: #2D1412;

  --font-sans: var(--font-plus-jakarta), system-ui, sans-serif;
  --font-mono: var(--font-jetbrains-mono), monospace;
}
```

---

## 4. Typography & Numerical Discipline

1. **UI & Section Headers (`Plus Jakarta Sans`):**
   - Loaded via `next/font/google` (`--font-plus-jakarta`).
   - Tight tracking (`tracking-[-0.02em]`), crisp `500` (Medium) and `600` (SemiBold) weights.
   - Technical micro-labels use uppercase `11px` (`text-[11px] uppercase tracking-[0.08em] text-pewter font-mono`).
2. **Addresses, Hashes, Hop Counters, Latency & JSON Receipts (`JetBrains Mono`):**
   - Loaded via `next/font/google` (`--font-jetbrains-mono`).
   - Always apply `font-mono tabular-nums` (`font-variant-numeric: tabular-nums`) on every latency counter, hop badge, USD quote, gas fee, and character-diff cell so layout never jitters when numbers update.

---

## 5. Layout Architecture (Dual-Command Split + Standalone Checkout)

### 5.1 Top Hardware Telemetry Bar
- Fixed-height (`56px`) institutional header displaying:
  - **Left:** `VEILPAY // PRE-SIGN GRAPH FIREWALL` hardware emblem + version badge (`v3.4 GSQL-ENGINE`).
  - **Center Telemetry Strip:** Live metrics (`LAST SCAN LATENCY`, `NODES INSPECTED`, `THREATS INTERCEPTED`, `DEFAULT VAULT: CAKE WALLET`, `ENGINE MODE: IN-MEMORY GSQL / LIVE RESTPP`).
  - **Right Controls:** Mode switcher (`[ Split Command View ]` | `[ Receiver Studio ]` | `[ Payer Checkout ]`), Settings Drawer trigger (`Crawl & Mainnet Cap`), and Reown `<appkit-button />` wallet connect pill styled in Warm Carbon & Burnished Copper.

### 5.2 Left Column (44% Width on Desktop): Receiver Command Center & Outbound Guard
- **Sub-Tab 1: Create Protected VeilPay Link (Module A)**
  - Payment Amount input (`250.00`) + Asset Selector (`USDC`, `ETH`, `USDT`, `BTC`, `XMR`) + Destination EVM Chain Selector (`Base 8453` default, `Arbitrum 42161`, `Ethereum 1`, `Optimism 10`, `Polygon 137`).
  - **Destination Vault Card:** Pre-selected `DEFAULT VAULT: CAKE WALLET` in Burnished Copper (`#D97736`) with 3 settlement modes (`Multi-Chain EVM via SOCKET`, `Bitcoin Silent Payment BIP-352 sp1...`, `Monero Subaddress RingCT 888...`) and live inline address validator.
  - **Firewall Policy Box:** Master toggle (`Block wallets within N hops of a drainer`), **5-step Hop Depth Segmented Control (`1 Hop` .. `5 Hops`, default `3 Hops`)**, Sybil Cluster Block Threshold slider (default `>= 10`), and engine switches (`CleanLink`, `Unbundle`, `SOCKET Auto-Bridge`).
  - **Live Shareable Link Bar:** Shows branded `veilpay.xyz/pay/<handle>` pill, copies the working `origin/pay/<handle>?c=<base64url>` link, and syncs live to the Payer Checkout panel.
- **Sub-Tab 2: "Safe Send" Outbound PoisonGraph Guard (Module E)**
  - 1-click test triggers (`Poisoned Vanity Clone 0x71C894a1...489B`, `Verified Trusted Contact 0x71C8f3b9...489B`, `Fresh Unrelated Wallet 0x22A9c001...771C`, plus malformed/wrong-network test triggers).
  - Renders **Side-by-Side 42-Character Monospace Diff Grid** (matching prefix/suffix highlighted in Ochre Amber `#D99B26`, forged middle bytes in Oxide Vermilion `#D6453A`), dust-factory fan-out subgraph (`4,210 outbound zero/micro-dust edges <= $0.01`), and 1-click **"Swap to Verified Contact Address"** recovery button.
- **Sub-Tab 3: Incoming Payment Feed**
  - Chronological audit log of every cleared, warned, and blocked scan during the session; clicking any row loads its exact subgraph and AIGI receipt into the inspector.

### 5.3 Right Column (56% Width on Desktop): Live Payer Checkout & Topological Graph Inspector
- **Live On-Chain Wallet Persona Bar (Module B):**
  - 4 instant persona cards (`Clean Arbitrum Whale`, `2-Hop Drainer Contagion`, `24-Wallet Sybil Bundle`, `Deep 4-Hop Historic Taint`) + Connected Reown Wallet button + Custom EVM/BTC/XMR address input (with live Etherscan V2 + GoPlus crawl).
- **Interactive 2D Topological Graph Canvas (Module C):**
  - High-DPI interactive SVG/Canvas node-link topology showing Payer (`Hop 0`), Intermediate Mules (`Hops 1..5`), Threat Entities (`PinkDrainer`, `Tornado`, `Exploit`), Collapsed/Expandable Sybil Cluster (`24 sibling wallets -> 0xB055...9999`), Cyclic Wash-Loops, and the **VeilPay Firewall Gate**.
  - Clicking any vertex or directed edge opens the **Node/Edge Telemetry Inspector** (`Address`, `Hop Distance`, `Tx Hash`, `Value USD`, `Timestamp`, `Risk Tag`, `GoPlus / ScamSniffer Flags`).
  - Includes a toggle tab to inspect **Raw TigerGraph RESTPP JSON & `/tigergraph/veilpay_firewall.gsql`**.
- **AIGI Forensic Verdict & Compliance Receipt Card (Module D):**
  - Displays `Verdict Status` badge, `Graph Traversal Telemetry`, `Hop-by-Hop Evidence Chain`, optional Gemini Executive Summary, `SHA-256 Cryptographic Audit Hash`, and **"Export Signed JSON Compliance Receipt"** button.
- **SOCKET Cross-Chain Settlement & Cake Wallet Vault Gate:**
  - Dynamically locked (`403 FIREWALL INTERCEPTED`) when blocked, or unlocked with live Socket Swap V3 route (`Socket Intents / Across`, output amount, service time, gas USD, calldata inspector, and Cake Wallet QR/URI modal) when cleared.
