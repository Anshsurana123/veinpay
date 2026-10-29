import { beforeEach, describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import {
  addressToBytes32,
  assertCctpTestnetContractsValid,
  bytes32ToAddress,
  calculateCctpFeeBreakdown,
  CCTP_FORWARDING_HOOK_DATA,
  CCTP_TESTNET_CHAINS,
  clearCctpTransferStoreForTests,
  computeCctpV2Quote,
  createCctpTransferRecord,
  encodeDepositForBurnCalldata,
  encodeReceiveMessageCalldata,
  getCctpDomainForChain,
  getCctpTransferByBurnTxHash,
  MESSAGE_TRANSMITTER_V2_ABI,
  pollCctpAttestationWithBackoff,
  saveCctpTransferRecord,
  TOKEN_MESSENGER_V2_ABI,
  transitionCctpTransfer,
  ZERO_BYTES32,
} from '@/lib/cctp';
import { fetchSocketCrossChainQuote } from '@/lib/socket/client';

const SAMPLE_PAYER = '0x4F2a9c117034e8B1200499A1c3f88200000188E1' as const;
const SAMPLE_VAULT = '0x71C95911E9a5D330f4D621842EC243EE1343292e' as const;

describe('Circle CCTP V2 Testnet Cross-Chain Routing & State Machine (Issue 1 / T1)', () => {
  beforeEach(() => {
    clearCctpTransferStoreForTests();
  });

  it('Validates official Circle CCTP V2 Testnet domain mappings and strict EIP-55 contract addresses', () => {
    expect(() => assertCctpTestnetContractsValid()).not.toThrow();

    expect(getCctpDomainForChain(11155111)).toBe(0); // Ethereum Sepolia
    expect(getCctpDomainForChain(11155420)).toBe(2); // OP Sepolia
    expect(getCctpDomainForChain(421614)).toBe(3); // Arbitrum Sepolia
    expect(getCctpDomainForChain(84532)).toBe(6); // Base Sepolia
    expect(getCctpDomainForChain(80002)).toBe(7); // Polygon Amoy
    expect(getCctpDomainForChain(8453)).toBeNull(); // Mainnet is not in testnet CCTP registry

    expect(CCTP_TESTNET_CHAINS[84532].tokenMessengerV2).toBe(
      '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
    );
    expect(CCTP_TESTNET_CHAINS[421614].messageTransmitterV2).toBe(
      '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
    );
    expect(CCTP_TESTNET_CHAINS[11155111].tokenMinterV2).toBe(
      '0xb43db544E2c27092c107639Ad201b3dEfAbcF192'
    );

    // Malformed address in registry must throw immediately
    expect(() =>
      assertCctpTestnetContractsValid({
        ...CCTP_TESTNET_CHAINS,
        84532: {
          ...CCTP_TESTNET_CHAINS[84532],
          tokenMessengerV2: '0xinvalid' as `0x${string}`,
        },
      })
    ).toThrow();
  });

  it('Left-pads EVM addresses to 32-byte CCTP mintRecipient format and round-trips cleanly', () => {
    const padded = addressToBytes32(SAMPLE_VAULT);
    expect(padded).toBe(
      '0x00000000000000000000000071c95911e9a5d330f4d621842ec243ee1343292e'
    );
    expect(padded.length).toBe(66);

    const recovered = bytes32ToAddress(padded);
    expect(recovered).toBe(SAMPLE_VAULT);
  });

  it('Encodes TokenMessengerV2.depositForBurn, depositForBurnWithHook, and MessageTransmitterV2.receiveMessage calldata', () => {
    const baseSepoliaUsdc = CCTP_TESTNET_CHAINS[84532].usdcAddress;
    const burnData = encodeDepositForBurnCalldata({
      amountAtomic: BigInt(25_000_000),
      destinationDomain: 3,
      mintRecipientAddress: SAMPLE_VAULT,
      burnTokenAddress: baseSepoliaUsdc,
      maxFeeAtomic: BigInt(2_500),
      minFinalityThreshold: 1000,
    });

    const decodedBurn = decodeFunctionData({
      abi: TOKEN_MESSENGER_V2_ABI,
      data: burnData,
    });
    expect(decodedBurn.functionName).toBe('depositForBurn');
    expect(decodedBurn.args[0]).toBe(BigInt(25_000_000));
    expect(decodedBurn.args[1]).toBe(3);
    expect(decodedBurn.args[2]).toBe(addressToBytes32(SAMPLE_VAULT));
    expect(decodedBurn.args[3].toLowerCase()).toBe(baseSepoliaUsdc.toLowerCase());
    expect(decodedBurn.args[4]).toBe(ZERO_BYTES32);
    expect(decodedBurn.args[5]).toBe(BigInt(2_500));
    expect(decodedBurn.args[6]).toBe(1000);

    const burnHookData = encodeDepositForBurnCalldata({
      amountAtomic: BigInt(25_000_000),
      destinationDomain: 3,
      mintRecipientAddress: SAMPLE_VAULT,
      burnTokenAddress: baseSepoliaUsdc,
      maxFeeAtomic: BigInt(52_500),
      minFinalityThreshold: 1000,
      useForwardingService: true,
    });
    const decodedHookBurn = decodeFunctionData({
      abi: TOKEN_MESSENGER_V2_ABI,
      data: burnHookData,
    });
    expect(decodedHookBurn.functionName).toBe('depositForBurnWithHook');
    expect(decodedHookBurn.args[7]).toBe(CCTP_FORWARDING_HOOK_DATA);

    const dummyMsg = '0x1234567890abcdef1234' as const;
    const dummyAttestation = '0xfedcba0987654321fedc' as const;
    const mintData = encodeReceiveMessageCalldata({
      message: dummyMsg,
      attestation: dummyAttestation,
    });
    const decodedMint = decodeFunctionData({
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      data: mintData,
    });
    expect(decodedMint.functionName).toBe('receiveMessage');
    expect(decodedMint.args[0]).toBe(dummyMsg);
    expect(decodedMint.args[1]).toBe(dummyAttestation);
  });

  it('Computes accurate fee and net-amount math and enforces Standard finality on Polygon Amoy source', async () => {
    const breakdown = calculateCctpFeeBreakdown({
      amountInAtomic: BigInt(100_000_000), // 100 USDC
      protocolFeeBps: 10, // 0.10% = 0.10 USDC (100_000 atomic)
      forwardingFeeSubunits: 50_000, // 0.05 USDC
    });
    expect(breakdown.protocolFeeAtomic).toBe(BigInt(100_000));
    expect(breakdown.totalFeeAtomic).toBe(BigInt(150_000));
    expect(breakdown.netAmountOutAtomic).toBe(BigInt(99_850_000));

    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify([
          { finalityThreshold: 1000, minimumFee: 2 },
          { finalityThreshold: 2000, minimumFee: 0 },
        ]),
        { status: 200 }
      );

    // Polygon Amoy (80002) does not support Fast Transfer as a source chain -> falls back to STANDARD (2000)
    const amoyOutcome = await computeCctpV2Quote({
      sourceChainId: 80002,
      destinationChainId: 421614,
      inputToken: 'USDC',
      outputToken: 'USDC',
      amountInAtomic: '25000000',
      userAddress: SAMPLE_PAYER,
      verifiedVaultAddress: SAMPLE_VAULT,
      requestedFinality: 'FAST',
      fetchImpl: mockFetch,
    });
    expect(amoyOutcome.ok).toBe(true);
    if (amoyOutcome.ok) {
      expect(amoyOutcome.route.finalityMode).toBe('STANDARD');
      expect(amoyOutcome.route.minFinalityThreshold).toBe(2000);
    }

    // Base Sepolia (84532) -> Arbitrum Sepolia (421614) supports Fast Transfer
    const outcome = await computeCctpV2Quote({
      sourceChainId: 84532,
      destinationChainId: 421614,
      inputToken: 'USDC',
      outputToken: 'USDC',
      amountInAtomic: '25000000', // 25 USDC
      userAddress: SAMPLE_PAYER,
      verifiedVaultAddress: SAMPLE_VAULT,
      requestedFinality: 'FAST',
      fetchImpl: mockFetch,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const { route } = outcome;
      expect(route.sourceDomain).toBe(6);
      expect(route.destinationDomain).toBe(3);
      expect(route.finalityMode).toBe('FAST');
      expect(route.minFinalityThreshold).toBe(1000);
      expect(route.expectedTimeSeconds).toBe(15);
      expect(route.protocolFeeBps).toBe(2);
      expect(route.totalFeeAtomic).toBe('5000'); // 25_000_000 * 2 / 10_000 = 5_000 (0.005 USDC)
      expect(route.netAmountOutAtomic).toBe('24995000'); // 24.995 USDC net
      expect(route.netAmountOutFormatted).toBe('24.995');
    }
  });

  it('Enforces CCTP state machine transitions and persists records by burnTxHash for reload resume', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify([
          { finalityThreshold: 1000, minimumFee: 1 },
          { finalityThreshold: 2000, minimumFee: 0 },
        ]),
        { status: 200 }
      );
    const outcome = await computeCctpV2Quote({
      sourceChainId: 84532,
      destinationChainId: 421614,
      inputToken: 'USDC',
      outputToken: 'USDC',
      amountInAtomic: '25000000',
      userAddress: SAMPLE_PAYER,
      verifiedVaultAddress: SAMPLE_VAULT,
      fetchImpl: mockFetch,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const burnHash =
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
    const mintHash =
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const;

    let rec = createCctpTransferRecord({
      linkId: 'ansh-audit',
      payerAddress: SAMPLE_PAYER,
      receiverVaultAddress: SAMPLE_VAULT,
      route: outcome.route,
    });
    expect(rec.status).toBe('QUOTED');

    // Invalid jump QUOTED -> MINTED must throw
    expect(() => transitionCctpTransfer(rec, 'MINTED')).toThrow();

    rec = transitionCctpTransfer(rec, 'APPROVING');
    rec = transitionCctpTransfer(rec, 'BURN_PENDING', { burnTxHash: burnHash });
    rec = transitionCctpTransfer(rec, 'BURN_CONFIRMED', { burnTxHash: burnHash });
    saveCctpTransferRecord(rec);

    // Simulate reload lookup by burnTxHash
    const resumed = getCctpTransferByBurnTxHash(burnHash);
    expect(resumed).not.toBeNull();
    expect(resumed?.status).toBe('BURN_CONFIRMED');

    rec = transitionCctpTransfer(resumed!, 'ATTESTATION_PENDING');
    rec = transitionCctpTransfer(rec, 'ATTESTED', {
      messageBytes: '0x1122334455',
      attestationHex: '0x6677889900',
    });
    rec = transitionCctpTransfer(rec, 'MINT_PENDING', { mintTxHash: mintHash });
    rec = transitionCctpTransfer(rec, 'MINTED', { mintTxHash: mintHash });
    saveCctpTransferRecord(rec);

    expect(getCctpTransferByBurnTxHash(burnHash)?.status).toBe('MINTED');
  });

  it('Polls Circle Iris Sandbox API handling PENDING, ATTESTED, TIMEOUT, and ERROR states', async () => {
    const sampleTxHash =
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const;

    // 1. PENDING -> ATTESTED after 2 polls
    let calls = 0;
    const pendingThenCompleteFetch: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({ messages: [{ status: 'pending_confirmations' }] }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          messages: [
            {
              status: 'complete',
              message: '0xdeadbeef1234',
              attestation: '0xcafebabe5678',
              eventNonce: '42',
            },
          ],
        }),
        { status: 200 }
      );
    };

    const completeRes = await pollCctpAttestationWithBackoff({
      sourceDomain: 6,
      transactionHash: sampleTxHash,
      initialDelayMs: 5,
      maxDelayMs: 10,
      timeoutMs: 500,
      fetchImpl: pendingThenCompleteFetch,
    });
    expect(completeRes.state).toBe('ATTESTED');
    expect(completeRes.message).toBe('0xdeadbeef1234');
    expect(completeRes.attestation).toBe('0xcafebabe5678');

    // 2. TIMEOUT when Iris stays pending
    const alwaysPendingFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ messages: [] }), { status: 404 });

    const timeoutRes = await pollCctpAttestationWithBackoff({
      sourceDomain: 6,
      transactionHash: sampleTxHash,
      initialDelayMs: 10,
      maxDelayMs: 15,
      timeoutMs: 35,
      fetchImpl: alwaysPendingFetch,
    });
    expect(timeoutRes.state).toBe('TIMEOUT');

    // 3. ERROR when Iris returns 500
    const errorFetch: typeof fetch = async () =>
      new Response('Internal Server Error', { status: 500 });

    const errRes = await pollCctpAttestationWithBackoff({
      sourceDomain: 6,
      transactionHash: sampleTxHash,
      initialDelayMs: 5,
      maxDelayMs: 10,
      timeoutMs: 100,
      fetchImpl: errorFetch,
    });
    expect(errRes.state).toBe('ERROR');
  });

  it('Enforces SAME_CHAIN_DIRECT with tx.chainId == destinationChainId and rejects non-USDC cross-chain on testnet', async () => {
    // Same-chain on testnet: Base Sepolia -> Base Sepolia
    const sameChainQuote = await fetchSocketCrossChainQuote({
      originChainId: 84532,
      destinationChainId: 84532,
      inputToken: 'USDC',
      outputToken: 'USDC',
      inputAmount: '10000000',
      userAddress: SAMPLE_PAYER,
      receiverAddress: SAMPLE_VAULT,
    });
    expect(sameChainQuote.success).toBe(true);
    expect(sameChainQuote.source).toBe('SAME_CHAIN_DIRECT');
    expect(sameChainQuote.result.routes[0].txData.object.chainId).toBe(
      sameChainQuote.result.destinationChainId
    );

    // Unsupported token cross-chain on testnet (ETH on Base Sepolia -> Arbitrum Sepolia)
    const unsupportedQuote = await fetchSocketCrossChainQuote({
      originChainId: 84532,
      destinationChainId: 421614,
      inputToken: 'ETH',
      outputToken: 'USDC',
      inputAmount: '10000000000000000',
      userAddress: SAMPLE_PAYER,
      receiverAddress: SAMPLE_VAULT,
    });
    expect(unsupportedQuote.success).toBe(false);
    expect(unsupportedQuote.source).toBe('UNSUPPORTED_ON_TESTNET');
    expect(unsupportedQuote.result.routes).toHaveLength(0);
  });
});
