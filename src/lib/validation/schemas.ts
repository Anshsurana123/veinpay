import { z } from 'zod';
import { isAddress } from 'viem';

// Strict boolean parser where null, undefined, and empty string resolve to undefined (triggering zod defaults)
export const strictBooleanSchema = z.preprocess((val) => {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  return val;
}, z.boolean());

export const evmAddressSchema = z
  .string()
  .trim()
  .refine((val) => isAddress(val, { strict: false }), {
    message: 'Must be a valid 42-character hexadecimal EVM address (0x...)',
  });

export const hopDepthSchema = z.preprocess(
  (val) => Number(val),
  z
    .number()
    .int()
    .min(1, { message: 'maxHops must be at least 1' })
    .max(5, { message: 'maxHops cannot exceed 5' })
);

export const firewallPolicySchema = z.object({
  firewallEnabled: strictBooleanSchema.default(true),
  maxHops: hopDepthSchema.default(3),
  cleanLinkEnabled: strictBooleanSchema.default(true),
  unbundleEnabled: strictBooleanSchema.default(true),
  poisonGraphEnabled: strictBooleanSchema.default(true),
  socketAutoBridgeEnabled: strictBooleanSchema.default(true),
  sybilBlockThreshold: z.coerce.number().int().min(2).max(100).default(10),
  inconclusivePolicy: z.enum(['BLOCK', 'WARN']).default('BLOCK'),
});

export const liveCrawlSettingsSchema = z.object({
  topFundersPerVertex: z.coerce.number().int().min(1).max(50).default(5),
  maxApiCallsPerScan: z.coerce.number().int().min(1).max(100).default(40),
  rateLimitRps: z.coerce.number().min(0.5).max(20).default(3),
  crawlTimeoutMs: z.coerce.number().int().min(500).max(30000).default(10000),
  maxMainnetUsdCap: z.coerce.number().min(0.1).max(1000).default(5),
  preferLiveTigerGraphRestpp: strictBooleanSchema.default(false),
  liveEtherscanCrawlEnabled: strictBooleanSchema.default(true),
});

// 1. /api/firewall/scan schemas
export const scanQuerySchema = z.object({
  targetWallet: evmAddressSchema.default(
    '0x4F2a9c117034e8B1200499A1c3f88200000188E1'
  ),
  chainId: z.coerce.number().int().default(42161),
  linkId: z.string().trim().default('default'),
  c: z.string().trim().nullable().optional(),
  sig: z.string().trim().nullable().optional(),
  includeGemini: strictBooleanSchema.default(false),
  proofOfControlToken: z.string().trim().nullable().optional(),
  simulated: strictBooleanSchema.default(false),
});

export const scanBodySchema = z.object({
  targetWallet: evmAddressSchema.default(
    '0x4F2a9c117034e8B1200499A1c3f88200000188E1'
  ),
  chainId: z.coerce.number().int().default(42161),
  linkId: z.string().trim().default('default'),
  c: z.string().trim().nullable().optional(),
  sig: z.string().trim().nullable().optional(),
  crawlSettings: liveCrawlSettingsSchema.partial().optional(),
  includeGemini: strictBooleanSchema.default(false),
  proofOfControlToken: z.string().trim().nullable().optional(),
  simulated: strictBooleanSchema.default(false),
});

// 2. /api/socket/quote schemas
export const socketQuoteQuerySchema = z.object({
  originChainId: z.coerce.number().int().default(42161),
  destinationChainId: z.coerce.number().int().default(8453),
  inputToken: z.string().trim().min(1),
  outputToken: z.string().trim().min(1),
  inputAmount: z.string().trim().regex(/^\d+$/, 'inputAmount must be numeric atomic units'),
  userAddress: evmAddressSchema,
  linkId: z.string().trim().default('default'),
  c: z.string().trim().nullable().optional(),
  sig: z.string().trim().nullable().optional(),
  scanAttestation: z.string().trim().nullable().optional(),
  slippage: z.string().trim().default('1'),
  sort: z.enum(['output', 'time']).default('output'),
});

// 3. /api/cctp/quote schema
export const cctpQuoteQuerySchema = z.object({
  originChainId: z.coerce.number().int().default(84532),
  destinationChainId: z.coerce.number().int().default(421614),
  inputToken: z.string().trim().default('USDC'),
  outputToken: z.string().trim().default('USDC'),
  inputAmount: z.string().trim().regex(/^\d+$/, 'inputAmount must be numeric atomic units'),
  userAddress: evmAddressSchema,
  linkId: z.string().trim().default('default'),
  c: z.string().trim().nullable().optional(),
  sig: z.string().trim().nullable().optional(),
  scanAttestation: z.string().trim().nullable().optional(),
  finalityMode: z.enum(['FAST', 'STANDARD']).default('FAST'),
  useForwardingService: strictBooleanSchema.default(false),
});

// 4. /api/aigi/verify schema
export const verifyReceiptBodySchema = z.object({
  receipt: z
    .object({
      canonicalPayloadJson: z.string().min(1),
      commitmentHash: z.string().optional(),
      cryptographicAuditHash: z.string().optional(),
      signature: z.string().optional(),
      keyId: z.string().optional(),
    })
    .optional(),
  canonicalPayloadJson: z.string().optional(),
  commitmentHash: z.string().optional(),
  cryptographicAuditHash: z.string().optional(),
  signature: z.string().optional(),
  keyId: z.string().optional(),
});

// 5. /api/aigi/verdict schemas
export const aigiVerdictQuerySchema = z.object({
  targetWallet: evmAddressSchema.default(
    '0x99B1c402881a77e3d90123456789aB00000FDead'
  ),
  merchantWallet: z.string().trim().default(''),
  maxHops: hopDepthSchema.default(3),
  firewallEnabled: strictBooleanSchema.default(true),
  includeGemini: strictBooleanSchema.default(false),
  linkId: z.string().trim().optional(),
  c: z.string().trim().nullable().optional(),
  sig: z.string().trim().nullable().optional(),
  scanAttestation: z.string().trim().nullable().optional(),
  proofOfControlToken: z.string().trim().nullable().optional(),
  simulated: strictBooleanSchema.default(false),
});

export const aigiVerdictBodySchema = z.object({
  targetWallet: z.string().trim().optional(),
  merchantWallet: z.string().trim().optional(),
  maxHops: hopDepthSchema.optional(),
  policy: firewallPolicySchema.partial().optional(),
  includeGemini: strictBooleanSchema.default(false),
  scan: z.record(z.string(), z.unknown()).optional(),
  linkId: z.string().trim().optional(),
  c: z.string().trim().nullable().optional(),
  sig: z.string().trim().nullable().optional(),
  scanAttestation: z.string().trim().nullable().optional(),
  proofOfControlToken: z.string().trim().nullable().optional(),
  simulated: strictBooleanSchema.default(false),
});

// 5b. /api/settlements/report schema
export const settlementReportBodySchema = z.object({
  linkId: z.string().trim().min(1),
  c: z.string().trim().nullable().optional(),
  sig: z.string().trim().nullable().optional(),
  scanAttestation: z.string().trim().min(1, 'scanAttestation is required to report settlement'),
  proofOfControlToken: z.string().trim().min(1, 'proofOfControlToken is required to report settlement'),
  txHash: z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/, 'txHash must be a 32-byte 0x-hex string').optional(),
  chainId: z.coerce.number().int(),
  settlementMode: z.enum(['EVM_SOCKET', 'BTC_SILENT_PAYMENT', 'XMR_SUBADDRESS']),
  amount: z.string().trim().min(1),
  asset: z.string().trim().default('USDC'),
  bridgeUsed: z.string().trim().optional(),
  simulated: strictBooleanSchema.default(false),
});

// 6. /api/events schemas
export const getEventsQuerySchema = z.object({
  linkId: z.string().trim().min(1, 'linkId is required to query events feed'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  simulated: strictBooleanSchema.optional(),
});

export const postEventBodySchema = z.object({
  linkId: z.string().trim().min(1),
  eventType: z.enum([
    'SCAN_RESULT',
    'SETTLEMENT_INITIATED',
    'SETTLEMENT_CONFIRMED',
    'SETTLEMENT_FAILED',
    'LINK_REVOCATION',
    'CCTP_TRANSFER_STATE',
  ]),
  status: z.enum([
    'BLOCKED',
    'PENDING',
    'CONFIRMED',
    'FAILED',
    'AWAITING_PAYMENT',
    'CLAIMED_UNVERIFIED',
    'ALLOWED',
    'REVOKED',
    'QUOTED',
    'APPROVING',
    'BURN_PENDING',
    'BURN_CONFIRMED',
    'ATTESTATION_PENDING',
    'ATTESTED',
    'MINT_PENDING',
    'MINTED',
  ]),
  txHash: z.string().trim().optional(),
  chainId: z.coerce.number().int().optional(),
  payerAddress: z.string().trim().optional(),
  receiverVault: z.string().trim().optional(),
  amount: z.string().trim().optional(),
  asset: z.string().trim().optional(),
  simulated: strictBooleanSchema.default(false),
  verdict: z.string().trim().optional(),
  hopDistance: z.coerce.number().int().optional(),
  latencyMs: z.coerce.number().optional(),
  executionSource: z.string().trim().optional(),
  sha256Hash: z.string().trim().optional(),
});

export const goPlusSecurityQuerySchema = z.object({
  type: z.enum(['address', 'token', 'approval', 'phishing']).default('address'),
  address: z.string().trim().optional(),
  url: z.string().trim().optional(),
  chainId: z.coerce.number().int().default(1),
});

// Generic validator returning parsed data or a 400 error response structure
export function validateWithZod<T>(
  schema: z.ZodSchema<T>,
  data: unknown
):
  | { success: true; data: T }
  | {
      success: false;
      error: 'VALIDATION_ERROR';
      message: string;
      fieldErrors: Record<string, string[]>;
    } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const flattened = result.error.flatten();
  return {
    success: false,
    error: 'VALIDATION_ERROR',
    message: 'Request input failed strict schema validation.',
    fieldErrors: flattened.fieldErrors as Record<string, string[]>,
  };
}
