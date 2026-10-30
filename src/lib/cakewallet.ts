/**
 * VeinPay — Cake Wallet Default Vault Integration
 * File: src/lib/cakewallet.ts
 *
 * Implements Cake Wallet default destination vault support for:
 *   1. Mode 1: Multi-Chain EVM / Solana Vault (Receives cross-chain tokens bridged via SOCKET)
 *   2. Mode 2: BIP-352 Bitcoin Silent Payments (sp1... via BIP-321 / legacy bitcoin: URIs)
 *   3. Mode 3: Monero Subaddress (RingCT 888... via monero: URIs)
 *
 * Generates scannable QR payloads, native protocol URIs, and cakewallet:// deep-links.
 */

import type { VaultSettlementMode } from '@/types/veinpay';
import {
  buildBip321SilentPaymentUri,
  buildLegacySilentPaymentUri,
  buildMoneroPaymentUri,
  validateBip352SilentPaymentAddress,
  validateMoneroAddress,
  validateMultiProtocolAddress,
} from '@/lib/validators/address';
import {
  DEMO_CAKE_VAULT_ADDRESSES,
  DEMO_TESTNET_CAKE_VAULT_ADDRESSES,
} from '@/lib/demo-fixtures';

export interface CakeWalletSettlementOption {
  mode: VaultSettlementMode;
  displayName: string;
  shortDescription: string;
  defaultProtocol: string;
  exampleAddress: string;
}

export const CAKE_WALLET_SETTLEMENT_MODES: CakeWalletSettlementOption[] = [
  {
    mode: 'EVM_SOCKET',
    displayName: 'Multi-Chain EVM / Solana Vault',
    shortDescription:
      'Receives cross-chain tokens auto-bridged via SOCKET directly into Cake Wallet EVM vault.',
    defaultProtocol: 'evm',
    exampleAddress: DEMO_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
  },
  {
    mode: 'BTC_SILENT_PAYMENT',
    displayName: 'BIP-352 Bitcoin Silent Payments',
    shortDescription:
      'Zero-doxx stealth Bitcoin address (sp1...). Generates unique one-time on-chain keys per payer.',
    defaultProtocol: 'bitcoin',
    exampleAddress: DEMO_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
  },
  {
    mode: 'XMR_SUBADDRESS',
    displayName: 'Monero Subaddress (RingCT)',
    shortDescription:
      'RingCT + stealth subaddress (888...). Unlocked strictly after firewall clears payer.',
    defaultProtocol: 'monero',
    exampleAddress: DEMO_CAKE_VAULT_ADDRESSES.XMR_SUBADDRESS,
  },
];

export interface CakeWalletUriParams {
  mode: VaultSettlementMode;
  vaultAddress: string;
  amount?: string;
  handle?: string;
  note?: string;
  legacyBtcFormat?: boolean;
}

/**
 * Builds the canonical payment URI for Cake Wallet settlement.
 * For Bitcoin: BIP-321 standard (bitcoin:?sp=sp1...&amount=...) or legacy (bitcoin:sp1...?amount=...)
 * For Monero: monero:888...?tx_amount=...&recipient_name=...
 * For EVM: 0x... destination vault address or ethereum: URI
 */
export function buildCakeWalletPaymentUri(params: CakeWalletUriParams): string {
  const { mode, vaultAddress, amount, handle, note, legacyBtcFormat } = params;
  const label = handle ? `VeinPay:${handle}` : 'VeinPay Vault';

  switch (mode) {
    case 'BTC_SILENT_PAYMENT':
      if (legacyBtcFormat) {
        return buildLegacySilentPaymentUri({
          spAddress: vaultAddress,
          amountBtc: amount,
          label,
        });
      }
      return buildBip321SilentPaymentUri({
        spAddress: vaultAddress,
        amountBtc: amount,
        label,
        message: note,
      });

    case 'XMR_SUBADDRESS':
      return buildMoneroPaymentUri({
        subaddress: vaultAddress,
        amountXmr: amount,
        recipientName: label,
        description: note,
      });

    case 'EVM_SOCKET':
    default:
      return vaultAddress;
  }
}

/**
 * Constructs a cakewallet:// native deep-link or fallbacks to standard protocol URI.
 */
export function buildCakeWalletDeepLink(params: CakeWalletUriParams): {
  deepLink: string;
  nativeUri: string;
} {
  const nativeUri = buildCakeWalletPaymentUri(params);
  // Cake Wallet supports opening native URIs directly or via cakewallet:// scheme
  const deepLink =
    nativeUri.startsWith('bitcoin:') || nativeUri.startsWith('monero:')
      ? nativeUri
      : `cakewallet://pay?address=${encodeURIComponent(params.vaultAddress)}${params.amount ? `&amount=${encodeURIComponent(params.amount)}` : ''}`;

  return {
    deepLink,
    nativeUri,
  };
}

export function validateCakeWalletVaultAddress(
  address: string,
  mode: VaultSettlementMode
) {
  return validateMultiProtocolAddress(address, mode);
}

// Re-export validators & fixtures for convenience
export {
  buildBip321SilentPaymentUri,
  buildLegacySilentPaymentUri,
  buildMoneroPaymentUri,
  validateBip352SilentPaymentAddress,
  validateMoneroAddress,
  DEMO_CAKE_VAULT_ADDRESSES,
  DEMO_TESTNET_CAKE_VAULT_ADDRESSES,
};
