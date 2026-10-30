# VeinPay — Exhaustive Edge-Case Matrix, Canonical Personas & Test Specification

> **Zero-Tolerance Rule #2:** Every scenario in this matrix is governed by real directed graph traversal (`src/lib/graph/engine.ts`) and character-level cryptographic validation (`src/lib/validators/address.ts` & `src/lib/graph/poison-guard.ts`). No hardcoded address-to-boolean shortcuts are permitted.

---

## 1. Canonical Seeded Personas & Exact Graph Topologies

All seeded EVM addresses are mathematically valid **EIP-55 checksummed** addresses whose prefixes and suffixes match the prompt specification:

| Persona ID | Label | Canonical EIP-55 Address | Prompt Shorthand / Alias | Graph Topology (`TRANSFERRED_TO` Lineage) |
| :--- | :--- | :--- | :--- | :--- |
| **`persona-1`** | **Clean Arbitrum Whale** | `0x4F2a9c117034e8B1200499A1c3f88200000188E1` | `0x4F2a...88E1` | • **Hop 1:** Funded by `Uniswap V3 USDC Pool` (`0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443`) & `Coinbase Institutional Hot Wallet` (`0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43`)<br>• **Hop 2:** Funded by `Circle Treasury Mint` (`0x55FE002aeFF02F77364de339a1292923A15844B8`) & `Aave V3 Arbitrum Pool`<br>• **Hop 3–5:** Clean institutional/DEX liquidity.<br>• **Result:** `VERIFIED_CLEAN` at all hop depths (`1..5`). |
| **`persona-2`** | **2-Hop Drainer Contagion** | `0x99B1c402881a77e3d90123456789aB00000FDead` | `0x99B1...Dead` | • **Hop 1:** Funded `4.20 ETH` (`$10,500`) by intermediate EOA `Mule_1` (`0x88E2a1004455667788990011223344556677A102`) — *Mule_1 is an unmarked EOA.*<br>• **Hop 2:** `Mule_1` was funded `14.50 ETH` (`$36,250`) by `PinkDrainer Exploit Contract` (`0xdead000000000000000000000000000000000001`, vertex type `ThreatEntity`, risk tag `APPROVAL_DRAINER`).<br>• **Result:** `VERIFIED_CLEAN` (with shallow-scan advisory) at `max_hops = 1`; **`INTERCEPTED_TAINT`** at `max_hops >= 2`. |
| **`persona-3`** | **24-Wallet Sybil Bundle & Wash Ring** | `0x5eb1a800112233445566778899aAbb0000010014` | `0x5eb1...0014` *(also resolves alias `0x5yb1...0014`)* | • **Hop 1:** Funded by distributor `Sybil_Relay_A` (`0x5eb100000000000000000000000000000000A001`) plus a 3-node cyclic wash-trading ring (`0x5eb1...0014 -> 0x5eb1...0015 -> 0x5eb1...0016 -> 0x5eb1...0014`) and a self-transfer edge (`0x5eb1...0014 -> 0x5eb1...0014`).<br>• **Hop 2:** `Sybil_Relay_A` and `Sybil_Relay_B` were funded in the same block (`#21048100`, 14s window) by `Sybil Mother Wallet` (`0xB055000000000000000000000000000000019999`), which fans out to **24 sibling wallets** (`0x5eb1...0001` through `0x5eb1...0024`).<br>• **Result:** Caught by `Unbundle` (`sybil_cluster_size = 24 >= 10`, `cyclic_loop_detected = true`) → **`INTERCEPTED_SYBIL`**. |
| **`persona-4`** | **Deep 4-Hop Historic Taint** | `0x33C077112233445566778899aABbcC00000540b0` | `0x33C0...40b0` *(also resolves alias `0x33C0...4Hop`)* | • **Hop 1:** Funded by `OTC_Desk_Settlement` (`0x11A0000000000000000000000000000000000001`)<br>• **Hop 2:** Funded by `Bridge_Relay_Hop2` (`0x22B0000000000000000000000000000000000002`)<br>• **Hop 3:** Funded by `Layering_Wallet_Hop3` (`0x33C0000000000000000000000000000000000003`)<br>• **Hop 4:** Funded by `Lazarus / Tornado Cash Sanctioned Mixer` (`0x098B716B8Aaf21512996dC57EB0615e2383E2f96`, vertex type `ThreatEntity`, risk tag `SANCTIONED_MIXER`).<br>• **Result:** **`VERIFIED_CLEAN`** at `max_hops = 1, 2, 3`; dynamically switches to **`INTERCEPTED_TAINT`** the instant the user selects **`[ 4 Hops ]`** or **`[ 5 Hops ]`**! |

---

## 2. Dynamic Hop-Depth Truth Table (`max_hops = 1..5`)

When `firewallEnabled = true`, `cleanLinkEnabled = true`, `unbundleEnabled = true`, and `sybilBlockThreshold = 10`:

| Persona | `max_hops = 1` | `max_hops = 2` | `max_hops = 3 (Default)` | `max_hops = 4` | `max_hops = 5` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Persona 1 (`0x4F2a...88E1`)** | `VERIFIED_CLEAN` (SOCKET Unlocked) | `VERIFIED_CLEAN` (SOCKET Unlocked) | `VERIFIED_CLEAN` (SOCKET Unlocked) | `VERIFIED_CLEAN` (SOCKET Unlocked) | `VERIFIED_CLEAN` (SOCKET Unlocked) |
| **Persona 2 (`0x99B1...Dead`)** | `VERIFIED_CLEAN` *(Shallow 1-Hop Advisory; SOCKET Unlocked)* | **`INTERCEPTED_TAINT`** *(Hop 2 PinkDrainer; SOCKET Locked)* | **`INTERCEPTED_TAINT`** *(Hop 2 PinkDrainer; SOCKET Locked)* | **`INTERCEPTED_TAINT`** *(Hop 2 PinkDrainer; SOCKET Locked)* | **`INTERCEPTED_TAINT`** *(Hop 2 PinkDrainer; SOCKET Locked)* |
| **Persona 3 (`0x5eb1...0014`)** | `WARNING_SYBIL` *(Self-transfer & 1-hop ring noted)* | **`INTERCEPTED_SYBIL`** *(24-wallet cluster at Hop 2; SOCKET Locked)* | **`INTERCEPTED_SYBIL`** *(24-wallet cluster at Hop 2; SOCKET Locked)* | **`INTERCEPTED_SYBIL`** *(24-wallet cluster; SOCKET Locked)* | **`INTERCEPTED_SYBIL`** *(24-wallet cluster; SOCKET Locked)* |
| **Persona 4 (`0x33C0...40b0`)** | `VERIFIED_CLEAN` (SOCKET Unlocked) | `VERIFIED_CLEAN` (SOCKET Unlocked) | `VERIFIED_CLEAN` (SOCKET Unlocked) | **`INTERCEPTED_TAINT`** *(Hop 4 Mixer Caught; SOCKET Locked)* | **`INTERCEPTED_TAINT`** *(Hop 4 Mixer Caught; SOCKET Locked)* |
| **Any Persona when Master Toggle = `OFF`** | `ADVISORY_BYPASSED` *(SOCKET Unlocked)* | `ADVISORY_BYPASSED` *(SOCKET Unlocked)* | `ADVISORY_BYPASSED` *(SOCKET Unlocked)* | `ADVISORY_BYPASSED` *(SOCKET Unlocked)* | `ADVISORY_BYPASSED` *(SOCKET Unlocked)* |

---

## 3. Cycle Detection & Self-Transfer Defense (Case 2)

1. **Algorithmic Guarantees in `src/lib/graph/engine.ts`:**
   - Maintains `minHopByVertex: Map<string, number>` initialized with `minHopByVertex.set(targetWallet, 0)`.
   - Maintain `visitedEdges: Set<string>` keyed by `${from}->${to}:${txHash}`.
   - If an edge points from a vertex to itself (`from === to`), it is immediately recorded in `selfTransferEdges[]` (`cyclic_loop_detected = true`) and **never** re-enqueued into the BFS frontier.
   - If a backward edge reaches a vertex `u` that is already in `ancestorsOnCurrentPath` (or already visited at a smaller hop distance with a forward path back to `targetWallet`), the cycle `Wallet A -> Wallet B -> Wallet C -> Wallet A` is recorded in `detectedCycles[][]` (`cyclic_loop_detected = true`), flagged in the `Unbundle` wash-trade report, and skipped from re-expansion.
   - **Result:** Worst-case time complexity is strictly $O(V + E)$—guaranteed zero infinite loops even on densely connected wash-trading cliques.

---

## 4. PoisonGraph Outbound Lookalike & Dust-Factory Guard (Case 4)

### 4.1 Mathematical Prefix/Suffix & Middle-Byte Diff Algorithm (`src/lib/graph/poison-guard.ts`)

Given a pasted candidate EVM address $C$ and the user's historical trusted contacts $T = \{t_1, t_2, \dots, t_k\}$:
1. Normalize both to 40 lowercase hex characters (stripping `0x`) for structural similarity, while preserving the 42-character EIP-55 strings for character-by-character display.
2. Compute:
   - `matchingPrefixChars`: length of common hex prefix starting after `0x` (plus `2` for `0x`). For `0x71C894a1...489B` vs `0x71C8f3b9...489B`, the first 6 characters `0x71C8` match (`4` hex chars after `0x`).
   - `matchingSuffixChars`: length of common hex suffix at the end of the address (`489B` = `4` matching suffix chars).
   - `forgedMiddleChars`: count of differing characters in the middle 32-character slice (`indices 6..37`).
3. Query the graph for:
   - `prior_legitimate_Interactions`: count of `TRANSFERRED_TO` edges from `merchant_wallet` to $C$ with `amount_usd > 0.01`.
   - `dust_out_degree`: count of outbound `DUSTED` / micro-transfer edges (`amount_usd <= 0.01` or `amount == 0`) originating from $C$ (or its immediate poisoning distributor).
4. **Classification Rules:**
   - **Sub-Case 4A (`INTERCEPTED_POISONING`):**
     - `C !== trustedContact` AND `(matchingPrefixHex >= 3 && matchingSuffixHex >= 3)` AND `prior_legitimate_interactions === 0` (or `dust_out_degree >= 50`).
     - Pasted `0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B` vs Trusted Contact `0x71C8f3b98812ABC90123456789ABcdef0003489B`:
       - Matches prefix `0x71C8` (6 chars) + suffix `489B` (4 chars) — rendered in **Ochre Amber (`#D99B26`)**.
       - Middle 32 chars differ — rendered in **Oxide Vermilion Red (`#D6453A`)**.
       - Shows `4,210 Outbound Zero-Value / Micro-Dust Transfers (<= $0.01)` in the graph canvas.
       - Provides 1-click **"Swap to Verified Contact Address (`0x71C8f3b9...489B`)"** button.
   - **Sub-Case 4B (`VERIFIED_FIRST_TIME_RECIPIENT`):**
     - Pasted `0x22A9c0018834dEf011223344556677880004771C` (valid EIP-55 address, does not mimic any trusted contact's prefix+suffix, `dust_out_degree === 0`).
     - Returns `"First-Time Recipient — Verified Zero Dust-Factory Activity"` in Botanical Jade (`#1F9D68`) without false-positive blocking.
   - **Sub-Case 4C (`INVALID_ADDRESS_OR_NETWORK_MISMATCH`):**
     - Detects and reports exact protocol/format errors immediately inline:
       1. Non-hex characters in `0x...` string (e.g., `'g'`, `'y'`, `'z'`) or wrong length ($\neq 42$).
       2. Invalid mixed-case EIP-55 checksum (offers a 1-click **"Auto-Fix to Valid EIP-55 Checksum"** button).
       3. Protocol mismatch: pasting a Bitcoin Silent Payment (`sp1...`) or Monero (`888...`) address into an EVM recipient field, or vice versa (`"Network Mismatch: Detected valid BIP-352 Bitcoin Silent Payment address in EVM field"`).

---

## 5. Automated Vitest Verification Suite (`src/lib/__tests__/`)

Our Vitest suite (`npm run test -- --run`) verifies all algorithmic invariants automatically:
1. `engine.hop-depth.test.ts`:
   - Asserts `Persona 2` returns `VERIFIED_CLEAN` at `max_hops = 1` and `INTERCEPTED_TAINT` at `max_hops = 2, 3, 4, 5`.
   - Asserts `Persona 4` returns `VERIFIED_CLEAN` at `max_hops = 1, 2, 3` and `INTERCEPTED_TAINT` at `max_hops = 4, 5`.
   - Asserts `firewallEnabled = false` returns `ADVISORY_BYPASSED` while preserving the discovered evidence edges.
2. `engine.cycles-and-sybil.test.ts`:
   - Constructs a 3-node cyclic wash loop (`A -> B -> C -> A`) + self-transfer (`A -> A`) and asserts traversal terminates in `<10ms` with `cyclic_loop_detected === true`.
   - Asserts `Persona 3` collapses all 24 sybil sibling wallets funded by `0xB055...9999` and returns `INTERCEPTED_SYBIL` when `sybilBlockThreshold = 10`, and `WARNING_SYBIL` when `sybilBlockThreshold = 30`.
3. `poison-guard.test.ts`:
   - Tests Sub-Case 4A (`0x71C894a1...489B` vs `0x71C8f3b9...489B` → `INTERCEPTED_POISONING`, exact character diff indices, `dust_out_degree = 4210`), Sub-Case 4B (`0x22A9c001...771C` → `VERIFIED_FIRST_TIME_RECIPIENT`), and Sub-Case 4C (bad EIP-55 checksum, wrong length, `sp1...` in EVM field, bad Bech32m checksum).
4. `aigi-determinism.test.ts`:
   - Runs `generateAigiForensicReceipt()` twice on identical graph output and verifies identical SHA-256 hex commitment hashes (`64` hex chars) and zero-hallucination citation of every edge hash.
5. `uri-and-socket-adapter.test.ts`:
   - Verifies BIP-321 (`bitcoin:?sp=sp1...`) and Monero (`monero:888...?tx_amount=...`) URI builders and tests the Socket V3 → V2/V3 adapter against `docs/reference/socket-v3-quote-sample.json`.
