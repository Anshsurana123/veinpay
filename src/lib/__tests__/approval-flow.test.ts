import { describe, expect, it } from 'vitest';
import {
  computeInitialSettlementStep,
  createInitialSettlementState,
  evaluateApprovalRequirement,
  isNativeTokenAddress,
  transitionSettlementStep,
} from '@/lib/settlement/approval-machine';
import { NATIVE_TOKEN_ADDRESS } from '@/lib/socket/tokens';

const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const SOCKET_GATEWAY = '0x3a23F943181408EAC424116Af7b7790c94Cb97a5';

describe('ERC-20 Approval & Settlement State Machine (Issue 5)', () => {
  it('Skips approval for native tokens', () => {
    expect(isNativeTokenAddress(NATIVE_TOKEN_ADDRESS)).toBe(true);
    expect(
      isNativeTokenAddress('0x0000000000000000000000000000000000000000')
    ).toBe(true);
    expect(isNativeTokenAddress(null)).toBe(true);
    expect(isNativeTokenAddress(ARB_USDC)).toBe(false);

    const evalNative = evaluateApprovalRequirement({
      inputTokenAddress: NATIVE_TOKEN_ADDRESS,
      approval: {
        tokenAddress: NATIVE_TOKEN_ADDRESS,
        spenderAddress: SOCKET_GATEWAY,
        minimumAmount: '100000000000000000',
      },
      currentAllowance: 0n,
    });

    expect(evalNative.isNative).toBe(true);
    expect(evalNative.requiresApproval).toBe(false);
    expect(computeInitialSettlementStep(evalNative)).toBe('ready');
  });

  it('Requires approval for non-native ERC-20 tokens when allowance < minimumAmount', () => {
    const evalInsufficient = evaluateApprovalRequirement({
      inputTokenAddress: ARB_USDC,
      approval: {
        tokenAddress: ARB_USDC,
        spenderAddress: SOCKET_GATEWAY,
        minimumAmount: '250000000',
      },
      currentAllowance: 100000000n,
    });

    expect(evalInsufficient.isNative).toBe(false);
    expect(evalInsufficient.requiresApproval).toBe(true);
    expect(evalInsufficient.spenderAddress).toBe(SOCKET_GATEWAY);
    expect(evalInsufficient.requiredAmount).toBe(250000000n);
    expect(computeInitialSettlementStep(evalInsufficient)).toBe(
      'needs-approval'
    );

    const evalSufficient = evaluateApprovalRequirement({
      inputTokenAddress: ARB_USDC,
      approval: {
        tokenAddress: ARB_USDC,
        spenderAddress: SOCKET_GATEWAY,
        minimumAmount: '250000000',
      },
      currentAllowance: 250000000n,
    });

    expect(evalSufficient.requiresApproval).toBe(false);
    expect(computeInitialSettlementStep(evalSufficient)).toBe('ready');
  });

  it('Transitions through needs-approval -> approving -> ready -> sending -> pending -> confirmed and failed', () => {
    let state = createInitialSettlementState(true);
    expect(state.step).toBe('needs-approval');

    state = transitionSettlementStep(
      state,
      { type: 'START_APPROVE' },
      { approvalTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111' }
    );
    expect(state.step).toBe('approving');
    expect(state.approvalTxHash).toBe(
      '0x1111111111111111111111111111111111111111111111111111111111111111'
    );

    state = transitionSettlementStep(state, { type: 'APPROVE_CONFIRMED' });
    expect(state.step).toBe('ready');

    state = transitionSettlementStep(state, { type: 'START_SEND' });
    expect(state.step).toBe('sending');

    state = transitionSettlementStep(
      state,
      { type: 'TX_SUBMITTED' },
      { settlementTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222' }
    );
    expect(state.step).toBe('pending');
    expect(state.settlementTxHash).toBe(
      '0x2222222222222222222222222222222222222222222222222222222222222222'
    );

    state = transitionSettlementStep(state, { type: 'TX_CONFIRMED' });
    expect(state.step).toBe('confirmed');

    state = transitionSettlementStep(state, {
      type: 'FAIL',
      reason: 'User rejected signature',
    });
    expect(state.step).toBe('failed');
    expect(state.errorMessage).toBe('User rejected signature');

    state = transitionSettlementStep(state, {
      type: 'RESET',
      requiresApproval: false,
    });
    expect(state.step).toBe('ready');
    expect(state.errorMessage).toBeNull();
  });
});
