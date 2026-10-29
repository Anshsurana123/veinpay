import type { VaultSettlementMode } from '@/types/veilpay';

// ============================================================================
// 1. DEMO PERSONA SHORTHAND ALIASES (FOR SIMULATOR GRAPH INPUT)
// ============================================================================

export const DEMO_ADDRESS_ALIASES: Record<string, string> = {
  '0x4f2a...88e1': '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
  '0x99b1...dead': '0x99B1c402881a77e3d90123456789aB00000FDead',
  '0x5yb1...0014': '0x5eb1a800112233445566778899aAbb0000010014',
  '0x5eb1...0014': '0x5eb1a800112233445566778899aAbb0000010014',
  '0x33c0...4hop': '0x33C077112233445566778899aABbcC00000540b0',
  '0x33c0...40b0': '0x33C077112233445566778899aABbcC00000540b0',
  '0x71c894a1...489b': '0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B',
  '0x71c8f3b9...489b': '0x71C8f3b98812ABC90123456789ABcdef0003489B',
  '0x22a9c001...771c': '0x22A9c0018834dEf011223344556677880004771C',
  // Legacy prompt non-hex full strings mapped to canonical EIP-55 equivalents
  '0x71c894a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5489b':
    '0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B',
  '0x71c8f3b98812abc90123456789abcdef771a489b':
    '0x71C8f3b98812ABC90123456789ABcdef0003489B',
};

// ============================================================================
// 2. PURE KECCAK-256 & STRICT EIP-55 CHECKSUM ENGINE
// ============================================================================

const KECCAK_RC: bigint[] = [
  1n,
  0x8082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x808bn,
  0x80000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x8an,
  0x88n,
  0x80008009n,
  0x8000000an,
  0x8000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x80000001n,
  0x8000000080008008n,
];

const KECCAK_R = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18,
  2, 61, 56, 14,
];

const KECCAK_PI = [
  0, 10, 20, 5, 15, 16, 1, 11, 21, 6, 7, 17, 2, 12, 22, 23, 8, 18, 3, 13, 14, 24,
  9, 19, 4,
];

const MASK_64 = 0xffffffffffffffffn;

function rot64(x: bigint, n: number): bigint {
  if (n === 0) return x;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK_64;
}

export function keccak256Ascii(asciiInput: string): string {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(asciiInput);
  const rate = 136;
  const padLen = rate - (inputBytes.length % rate);
  const padded = new Uint8Array(inputBytes.length + padLen);
  padded.set(inputBytes, 0);
  padded[inputBytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const view = new DataView(padded.buffer);
  const state = new Array<bigint>(25).fill(0n);

  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < 17; i++) {
      state[i] ^= view.getBigUint64(offset + i * 8, true);
    }
    for (let round = 0; round < 24; round++) {
      const C = new Array<bigint>(5);
      const D = new Array<bigint>(5);
      const B = new Array<bigint>(25);

      for (let x = 0; x < 5; x++) {
        C[x] =
          state[x] ^
          state[x + 5] ^
          state[x + 10] ^
          state[x + 15] ^
          state[x + 20];
      }
      for (let x = 0; x < 5; x++) {
        D[x] = C[(x + 4) % 5] ^ rot64(C[(x + 1) % 5], 1);
      }
      for (let i = 0; i < 25; i++) {
        state[i] ^= D[i % 5];
      }
      for (let i = 0; i < 25; i++) {
        B[KECCAK_PI[i]] = rot64(state[i], KECCAK_R[i]);
      }
      for (let y = 0; y < 25; y += 5) {
        for (let x = 0; x < 5; x++) {
          state[y + x] =
            B[y + x] ^ ((~B[y + ((x + 1) % 5)] & MASK_64) & B[y + ((x + 2) % 5)]);
        }
      }
      state[0] ^= KECCAK_RC[round];
    }
  }

  let hex = '';
  for (let i = 0; i < 4; i++) {
    let word = state[i];
    for (let b = 0; b < 8; b++) {
      const byteVal = Number(word & 0xffn);
      hex += byteVal.toString(16).padStart(2, '0');
      word >>= 8n;
    }
  }
  return hex;
}

export function toEip55Address(rawAddress: string): string {
  const clean = rawAddress.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new Error(`Invalid 20-byte hex address: ${rawAddress}`);
  }
  const hash = keccak256Ascii(clean);
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const nibble = parseInt(hash[i], 16);
    out += nibble >= 8 ? clean[i].toUpperCase() : clean[i];
  }
  return out;
}

// ============================================================================
// 3. BECH32M VALIDATOR FOR BIP-352 BITCOIN SILENT PAYMENTS (sp1... / tsp1...)
// ============================================================================

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >>> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

export function validateBip352SilentPaymentAddress(input: string): {
  valid: boolean;
  network?: 'mainnet' | 'testnet';
  error?: string;
} {
  const trimmed = input.trim();
  if (trimmed.toLowerCase() !== trimmed && trimmed.toUpperCase() !== trimmed) {
    return { valid: false, error: 'Mixed-case characters are forbidden in Bech32m BIP-352 addresses.' };
  }
  const lower = trimmed.toLowerCase();
  const sepIndex = lower.lastIndexOf('1');
  if (sepIndex < 1) {
    return { valid: false, error: 'Missing Bech32m separator "1" in Silent Payment address.' };
  }
  const hrp = lower.slice(0, sepIndex);
  if (hrp !== 'sp' && hrp !== 'tsp') {
    return {
      valid: false,
      error: `Invalid BIP-352 human-readable prefix "${hrp}" (expected "sp" or "tsp").`,
    };
  }
  const dataPart = lower.slice(sepIndex + 1);
  if (dataPart.length < 110 || dataPart.length > 120) {
    return {
      valid: false,
      error: `Invalid BIP-352 payload length (${dataPart.length} chars; expected ~113 chars for 66-byte scan+spend keys).`,
    };
  }
  const dataValues: number[] = [];
  for (let i = 0; i < dataPart.length; i++) {
    const ch = dataPart[i];
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx === -1) {
      return {
        valid: false,
        error: `Forbidden Bech32m character "${ch}" at position ${sepIndex + 1 + i}.`,
      };
    }
    dataValues.push(idx);
  }
  // Version 0 Silent Payment address must start with 5-bit value 0 ('q')
  if (dataValues[0] !== 0) {
    return {
      valid: false,
      error: `Unsupported Silent Payment version ${dataValues[0]} (expected version 0 "q").`,
    };
  }
  const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...dataValues]);
  if (polymod !== BECH32M_CONST) {
    return {
      valid: false,
      error: 'Bech32m cryptographic checksum verification failed.',
    };
  }
  return {
    valid: true,
    network: hrp === 'sp' ? 'mainnet' : 'testnet',
  };
}

// ============================================================================
// 4. MONERO SUBADDRESS (8...) & STANDARD ADDRESS (4...) VALIDATOR
// ============================================================================

const MONERO_BASE58_REGEX =
  /^[48][123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{94,105}$/;

export function validateMoneroAddress(input: string): {
  valid: boolean;
  addressType?: 'SUBADDRESS' | 'STANDARD' | 'INTEGRATED';
  error?: string;
} {
  const trimmed = input.trim();
  if (!trimmed.startsWith('8') && !trimmed.startsWith('4')) {
    return {
      valid: false,
      error: 'Monero address must start with "8" (RingCT Subaddress) or "4" (Standard/Integrated).',
    };
  }
  if (trimmed.length !== 95 && trimmed.length !== 106) {
    return {
      valid: false,
      error: `Invalid Monero address length (${trimmed.length} chars; expected 95 for subaddress/standard or 106 for integrated).`,
    };
  }
  if (!MONERO_BASE58_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: 'Address contains invalid Base58 characters (0, O, I, l are forbidden).',
    };
  }
  return {
    valid: true,
    addressType:
      trimmed.startsWith('8')
        ? 'SUBADDRESS'
        : trimmed.length === 106
          ? 'INTEGRATED'
          : 'STANDARD',
  };
}

// ============================================================================
// 5. UNIFIED MULTI-PROTOCOL ADDRESS VALIDATOR (HANDLES CASE 4C)
// ============================================================================

export interface AddressValidationReport {
  valid: boolean;
  detectedProtocol: 'EVM' | 'BTC_SILENT_PAYMENT' | 'XMR_SUBADDRESS' | 'INVALID';
  normalizedAddress: string | null;
  checksumValid: boolean;
  checksumFixSuggestion?: string;
  resolvedAliasFrom?: string;
  errorMessage?: string;
}

export function validateMultiProtocolAddress(
  rawInput: string,
  expectedMode?: VaultSettlementMode
): AddressValidationReport {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      valid: false,
      detectedProtocol: 'INVALID',
      normalizedAddress: null,
      checksumValid: false,
      errorMessage: 'Address cannot be empty.',
    };
  }

  // Check if input matches a known demo shorthand alias
  const aliasMatch = DEMO_ADDRESS_ALIASES[trimmed.toLowerCase()];

  // 1. Detect Bitcoin Silent Payment (sp1... / tsp1...)
  if (trimmed.toLowerCase().startsWith('sp1') || trimmed.toLowerCase().startsWith('tsp1')) {
    const spCheck = validateBip352SilentPaymentAddress(trimmed);
    if (!spCheck.valid) {
      return {
        valid: false,
        detectedProtocol: 'BTC_SILENT_PAYMENT',
        normalizedAddress: null,
        checksumValid: false,
        errorMessage: spCheck.error,
      };
    }
    if (expectedMode && expectedMode !== 'BTC_SILENT_PAYMENT') {
      return {
        valid: false,
        detectedProtocol: 'BTC_SILENT_PAYMENT',
        normalizedAddress: trimmed.toLowerCase(),
        checksumValid: true,
        errorMessage: `Network Mismatch: Valid BIP-352 Bitcoin Silent Payment address (sp1...) pasted into ${expectedMode === 'EVM_SOCKET' ? 'EVM 0x' : 'Monero'} field.`,
      };
    }
    return {
      valid: true,
      detectedProtocol: 'BTC_SILENT_PAYMENT',
      normalizedAddress: trimmed.toLowerCase(),
      checksumValid: true,
    };
  }

  // 2. Detect Monero Address (8... or 4... with length >= 50)
  if ((trimmed.startsWith('8') || trimmed.startsWith('4')) && !trimmed.startsWith('0x')) {
    const xmrCheck = validateMoneroAddress(trimmed);
    if (!xmrCheck.valid) {
      return {
        valid: false,
        detectedProtocol: 'XMR_SUBADDRESS',
        normalizedAddress: null,
        checksumValid: false,
        errorMessage: xmrCheck.error,
      };
    }
    if (expectedMode && expectedMode !== 'XMR_SUBADDRESS') {
      return {
        valid: false,
        detectedProtocol: 'XMR_SUBADDRESS',
        normalizedAddress: trimmed,
        checksumValid: true,
        errorMessage: `Network Mismatch: Valid Monero RingCT ${xmrCheck.addressType} address pasted into ${expectedMode === 'EVM_SOCKET' ? 'EVM 0x' : 'Bitcoin Silent Payment'} field.`,
      };
    }
    return {
      valid: true,
      detectedProtocol: 'XMR_SUBADDRESS',
      normalizedAddress: trimmed,
      checksumValid: true,
    };
  }

  // 3. Detect EVM Address (0x...)
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    if (aliasMatch && trimmed.includes('...')) {
      return {
        valid: true,
        detectedProtocol: 'EVM',
        normalizedAddress: aliasMatch,
        checksumValid: true,
        resolvedAliasFrom: trimmed,
      };
    }

    const body = trimmed.slice(2);
    if (body.length !== 40) {
      return {
        valid: false,
        detectedProtocol: 'EVM',
        normalizedAddress: null,
        checksumValid: false,
        checksumFixSuggestion: aliasMatch,
        errorMessage: `Invalid EVM address length (${trimmed.length} chars; expected exactly 42 characters starting with 0x).`,
      };
    }

    const nonHexMatch = body.match(/[^0-9a-fA-F]/);
    if (nonHexMatch) {
      return {
        valid: false,
        detectedProtocol: 'EVM',
        normalizedAddress: null,
        checksumValid: false,
        checksumFixSuggestion: aliasMatch,
        errorMessage: `Invalid non-hexadecimal character "${nonHexMatch[0]}" in EVM address.`,
      };
    }

    const eip55 = toEip55Address(trimmed);
    const isAllLower = body === body.toLowerCase();
    const isAllUpper = body === body.toUpperCase();
    const isExactEip55 = trimmed === eip55;

    if (!isAllLower && !isAllUpper && !isExactEip55) {
      return {
        valid: false,
        detectedProtocol: 'EVM',
        normalizedAddress: eip55,
        checksumValid: false,
        checksumFixSuggestion: aliasMatch ?? eip55,
        errorMessage: 'EIP-55 mixed-case checksum mismatch detected (possible manual typo or un-checksummed vanity string).',
      };
    }

    if (expectedMode && expectedMode !== 'EVM_SOCKET') {
      return {
        valid: false,
        detectedProtocol: 'EVM',
        normalizedAddress: eip55,
        checksumValid: true,
        errorMessage: `Network Mismatch: Valid EVM address (0x...) pasted into ${expectedMode === 'BTC_SILENT_PAYMENT' ? 'Bitcoin Silent Payment (sp1...)' : 'Monero Subaddress (888...)'} field.`,
      };
    }

    return {
      valid: true,
      detectedProtocol: 'EVM',
      normalizedAddress: eip55,
      checksumValid: true,
    };
  }

  return {
    valid: false,
    detectedProtocol: 'INVALID',
    normalizedAddress: null,
    checksumValid: false,
    errorMessage:
      'Unrecognized address format. Expected EVM (0x...), Bitcoin Silent Payment (sp1...), or Monero Subaddress (888...).',
  };
}

// ============================================================================
// 6. SPEC-COMPLIANT CAKE WALLET URI BUILDERS (BIP-321, BIP-352 & MONERO)
// ============================================================================

export function buildBip321SilentPaymentUri(params: {
  spAddress: string;
  amountBtc?: string | number;
  label?: string;
  message?: string;
}): string {
  const query = new URLSearchParams();
  query.set('sp', params.spAddress.trim());
  const numericAmount = Number(params.amountBtc);
  if (!Number.isNaN(numericAmount) && numericAmount > 0) {
    query.set('amount', numericAmount.toFixed(6).replace(/\.?0+$/, ''));
  }
  if (params.label) {
    query.set('label', params.label);
  }
  if (params.message) {
    query.set('message', params.message);
  }
  // Standard URLSearchParams encodes spaces as '+', replace with '%20' per BIP-21/BIP-321
  return `bitcoin:?${query.toString().replace(/\+/g, '%20')}`;
}

export function buildLegacySilentPaymentUri(params: {
  spAddress: string;
  amountBtc?: string | number;
  label?: string;
}): string {
  const query = new URLSearchParams();
  const numericAmount = Number(params.amountBtc);
  if (!Number.isNaN(numericAmount) && numericAmount > 0) {
    query.set('amount', numericAmount.toFixed(6).replace(/\.?0+$/, ''));
  }
  if (params.label) {
    query.set('label', params.label);
  }
  const qs = query.toString().replace(/\+/g, '%20');
  return qs ? `bitcoin:${params.spAddress.trim()}?${qs}` : `bitcoin:${params.spAddress.trim()}`;
}

export function buildMoneroPaymentUri(params: {
  subaddress: string;
  amountXmr?: string | number;
  recipientName?: string;
  description?: string;
}): string {
  const query = new URLSearchParams();
  const numericAmount = Number(params.amountXmr);
  if (!Number.isNaN(numericAmount) && numericAmount > 0) {
    query.set('tx_amount', numericAmount.toFixed(6).replace(/\.?0+$/, ''));
  }
  if (params.recipientName) {
    query.set('recipient_name', params.recipientName);
  }
  if (params.description) {
    query.set('tx_description', params.description);
  }
  const qs = query.toString().replace(/\+/g, '%20');
  return qs ? `monero:${params.subaddress.trim()}?${qs}` : `monero:${params.subaddress.trim()}`;
}

export function formatShortAddress(address: string, prefixLen = 6, suffixLen = 4): string {
  if (!address || address.length <= prefixLen + suffixLen + 3) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}
