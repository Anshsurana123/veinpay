# Circle CCTP V2 Testnet End-to-End Verification Runbook (Base Sepolia → Arbitrum Sepolia)

This runbook documents the step-by-step manual procedure to execute and verify a live cross-chain testnet USDC settlement from **Base Sepolia (Chain ID `84532`, CCTP Domain `6`)** to **Arbitrum Sepolia (Chain ID `421614`, CCTP Domain `3`)** using Circle's Cross-Chain Transfer Protocol V2 (`TokenMessengerV2` & `MessageTransmitterV2`).

---

## 1. Official Circle CCTP V2 Testnet Contracts & Domains

All contract addresses and domain identifiers are sourced from Circle's official documentation:
- **Contract Addresses:** `https://developers.circle.com/cctp/cctp-smart-contracts`
- **Supported Domains:** `https://developers.circle.com/cctp/cctp-supported-blockchains`
- **Iris Sandbox Attestation API:** `https://iris-api-sandbox.circle.com`

| Parameter | Base Sepolia (Origin) | Arbitrum Sepolia (Destination) |
| :--- | :--- | :--- |
| **EVM Chain ID** | `84532` | `421614` |
| **Circle CCTP V2 Domain** | `6` | `3` |
| **Testnet USDC Contract** | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| **`TokenMessengerV2`** | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| **`MessageTransmitterV2`** | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| **`TokenMinterV2`** | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |

---

## 2. Prerequisites & Testnet Funding

1. **Two EVM Wallets (or one wallet acting as both Receiver and Payer):**
   - **Receiver Vault Wallet:** Controls the destination address on Arbitrum Sepolia (`421614`).
   - **Payer Wallet:** Controls the sending address on Base Sepolia (`84532`).
2. **Testnet Native Gas (ETH):**
   - Fund the Payer Wallet with at least `0.005 ETH` on **Base Sepolia** (for ERC-20 `approve` + `depositForBurn`).
   - Fund either the Payer or Receiver Wallet with at least `0.005 ETH` on **Arbitrum Sepolia** (to execute `MessageTransmitterV2.receiveMessage(message, attestation)` if not using Circle Forwarding).
3. **Testnet USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e` on Base Sepolia):**
   - Request `10 USDC` on **Base Sepolia** from the official Circle USDC Faucet: `https://faucet.circle.com/`.

---

## 3. Step-by-Step End-to-End Verification

### Step 1: Create a Signed Receiver Payment Link on Arbitrum Sepolia
1. Start the local VeilPay server (`npm run dev`) and open `http://localhost:3000`.
2. Connect the **Receiver Wallet** via Reown AppKit.
3. In the **Receiver Command Center**:
   - Set **Destination Chain** to `Arbitrum Sepolia (421614)`.
   - Set **Settlement Asset** to `USDC`.
   - Set **Requested Amount** to `5` (`5.00 USDC`).
   - Enter the Receiver's checksummed EVM vault address (`0x...`) matching the connected signer.
4. Click **Sign & Create Payment Link** and approve the EIP-712 `PaymentLink` signature in your wallet.

### Step 2: Connect Payer Wallet on Base Sepolia & Complete Proof of Control
1. Open the generated `/pay/<handle>?c=...&sig=...` link (or use the Payer Checkout panel).
2. Connect the **Payer Wallet** on **Base Sepolia (`84532`)** and select `Base Sepolia (Testnet)` as the Payer Origin Chain with `USDC` as the Payer Token.
3. Sign the Proof-of-Control challenge (`POST /api/session/nonce` → `POST /api/session/verify`) so the connected wallet is cryptographically bound to the scanned wallet.
4. Verify the TigerGraph Pre-Sign Firewall returns `VERIFIED_CLEAN` and unlocks the quote step.

### Step 3: Verify the Circle CCTP V2 Quote (`GET /api/cctp/quote`)
1. Confirm the quote badge displays `CCTP_V2_TESTNET`.
2. Verify the displayed fields:
   - **Source Domain:** `6` (Base Sepolia) → **Destination Domain:** `3` (Arbitrum Sepolia)
   - **Finality Mode:** `FAST` (`minFinalityThreshold = 1000`, expected time `~15 sec`)
   - **Gross Amount In:** `5.00 USDC` (`5000000` atomic units)
   - **CCTP Burn Fee:** Queried live from `GET https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/6/3`
   - **Net Amount Received:** `amountIn - fee` (e.g., `4.9995 USDC`)

### Step 4: Execute ERC-20 `approve` & `TokenMessengerV2.depositForBurn` on Base Sepolia
1. Open the **Settlement Modal** and click **Sign & Broadcast on Base Sepolia**.
2. **State `APPROVING`:** If current USDC allowance to `TokenMessengerV2` (`0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`) is less than `5000000`, approve the transaction in your wallet and wait for receipt confirmation.
3. **State `BURN_PENDING` → `BURN_CONFIRMED`:** Confirm the `TokenMessengerV2.depositForBurn` transaction in your wallet:
   - `amount`: `5000000`
   - `destinationDomain`: `3`
   - `mintRecipient`: Receiver's verified vault address left-padded to `bytes32`
   - `burnToken`: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
   - `destinationCaller`: `0x0000000000000000000000000000000000000000000000000000000000000000`
   - `maxFee`: `feeAtomic`
   - `minFinalityThreshold`: `1000`
4. Copy the Base Sepolia `burnTxHash` (`0x...`) and verify on `https://sepolia.basescan.org/tx/<burnTxHash>`.

### Step 5: Poll Circle Iris Sandbox Attestation (`GET /api/cctp/attestation`)
1. **State `ATTESTATION_PENDING` → `ATTESTED`:** VeilPay automatically polls `/api/cctp/attestation?sourceDomain=6&transactionHash=<burnTxHash>`, which queries:
   ```text
   GET https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=<burnTxHash>
   ```
2. Reload the page while polling is in progress to verify that the transfer record is persisted by `burnTxHash` and resumes cleanly without losing progress.
3. Once `messages[0].status === "complete"`, the state machine transitions to `ATTESTED` with `message` and `attestation` hex payloads populated.

### Step 6: Complete Transfer (`MessageTransmitterV2.receiveMessage`) & Verify Mint on Arbitrum Sepolia
1. Click **Complete Transfer (Mint USDC)** using either the Payer or Receiver wallet.
2. Your wallet switches to **Arbitrum Sepolia (`421614`)** and submits `MessageTransmitterV2.receiveMessage(message, attestation)` to `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`.
3. **State `MINT_PENDING` → `MINTED`:** After the Arbitrum Sepolia transaction confirms, VeilPay calls `POST /api/cctp/verify-mint` to verify:
   - Transaction receipt `status === "success"`
   - Target contract `to === 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
   - Emitted `MessageReceived` log from `MessageTransmitterV2`
   - Emitted ERC-20 `Transfer` log on Arbitrum Sepolia USDC (`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`) crediting the Receiver's vault address with `>= netAmountReceived`.
4. Verify the final Arbitrum Sepolia transaction on `https://sepolia.arbiscan.io/tx/<mintTxHash>`.
