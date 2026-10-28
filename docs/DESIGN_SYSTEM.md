# VeilPay — Institutional Hardware & Financial Terminal Design System

> **CRITICAL RULE:** Section 1.3 and Section 3 of the Execution Mandate **strictly supersede** the legacy color notes in `project brief.txt`. Purple, indigo, violet, lavender, or magenta colors (`#6366F1`, `#8B5CF6`, `purple-*`, `indigo-*`, `violet-*`) are **STRICTLY BANNED** across the entire repository.

---

## 1. Aesthetic Philosophy: Luxury Swiss Instrument & Financial Terminal

VeilPay is designed as a tactile, high-precision **Institutional Hardware / Financial Security Terminal** inspired by **Teenage Engineering OP-1 / TX-6**, **Linear**, and **Bloomberg Terminal**:
- **Zero Marketing Fluff:** No hero banners, no 3-column emoji cards, no fake testimonials, no decorative blobs, no glassmorphic neon gradients.
- **Structural Precision:** Crisp `1px solid #262A33` hairline borders, subtle anodized surface elevation, mechanical segmented controls, LED status indicators, and real-time tabular telemetry (`tabular-nums`).

---

## 2. Locked Color Token System (Warm Carbon, Burnished Copper & Botanical Jade)

| Semantic Token | Hex Code | CSS Custom Property | Usage |
| :--- | :--- | :--- | :--- |
| **Canvas Primary** | `#0B0C0E` | `--vp-bg-canvas` | Deep Warm Carbon root background (zero blue-light harshness). |
| **Surface Elevated** | `#131519` | `--vp-bg-panel` | Rich Graphite Slate panel & module container background. |
| **Surface Interactive** | `#1A1D23` | `--vp-bg-card` | Interactive inputs, segmented controls, and hoverable cards. |
| **Border Hairline** | `#262A33` | `--vp-border` | Structural `1px solid` hairline dividers and card borders. |
| **Border Focus / Active** | `#383E4C` | `--vp-border-strong` | Active input borders and emphasized terminal cells. |
| **Text Primary** | `#F3F1EC` | `--vp-text-primary` | Warm Alabaster Ivory primary copy and headers (never harsh `#FFFFFF`). |
| **Text Secondary / Muted** | `#9499A3` | `--vp-text-muted` | Warm Pewter labels, column headers, and secondary metadata. |
| **Text Dim / Technical** | `#636875` | `--vp-text-dim` | Inactive ticks, byte offsets, and subtle hints. |
| **Brand & Cake Wallet Accent** | `#D97736` | `--vp-accent-copper` | Burnished Copper / Terracotta primary brand & Cake Wallet vault accent. |
| **Brand Secondary Accent** | `#E5A93C` | `--vp-accent-gold` | Warm Bullion Gold secondary highlight & active selector indicator. |
| **Status Verified Clean** | `#1F9D68` | `--vp-status-clean` | Deep Botanical Jade for `VERIFIED_CLEAN`, cleared hops, and active SOCKET routes. |
| **Status Clean Fill** | `#0E291E` | `--vp-status-clean-bg` | Subtle badge background for verified states. |
| **Status Sybil / Warning** | `#D99B26` | `--vp-status-warn` | Rich Ochre Amber for `Unbundle` sybil clusters, prefix/suffix matches, and bypass advisories. |
| **Status Warning Fill** | `#2B210D` | `--vp-status-warn-bg` | Subtle badge background for warning states. |
| **Status Firewall Block** | `#D6453A` | `--vp-status-block` | Oxide Vermilion Red for `CleanLink` drainer taint, `PoisonGraph` intercepts, and forged middle bytes. |
| **Status Block Fill** | `#2D1412` | `--vp-status-block-bg` | Subtle badge background for blocked/intercepted states. |

---

## 3. Tailwind CSS v4 Configuration (`src/app/globals.css`)

Because Next.js 16 ships with **Tailwind CSS v4.3+**, we use native CSS-first `@import "tailwindcss";` and `@theme` blocks in `src/app/globals.css` (do **not** mix deprecated Tailwind v3 `tailwind.config.js` plugins with v4):

```css
@import "tailwindcss";

@theme {
  --color-carbon-950: #0B0C0E;
  --color-carbon-900: #131519;
  --color-carbon-800: #1A1D23;
  --color-carbon-700: #262A33;
  --color-carbon-600: #383E4C;

  --color-alabaster: #F3F1EC;
  --color-pewter: #9499A3;
  --color-slate-dim: #636875;

  --color-copper: #D97736;
  --color-copper-bg: #2A190E;
  --color-gold: #E5A93C;

  --color-jade: #1F9D68;
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
