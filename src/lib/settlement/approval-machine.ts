import { NATIVE_TOKEN_ADDRESS } from '@/lib/socket/tokens';

export type SettlementFlowStep =
  | 'needs-approval'
  | 'approving'
  | 'ready'
  | 'sending'
  | 'pending'
  | 'confirmed'
  | 'failed';

export interface ApprovalRequirementInput {
  inputTokenAddress?: string | null;
  approval?: {
    tokenAddress: string;
    spenderAddress: string;
    amount?: string;
    minimumAmount?: string;
  } | null;
  currentAllowance?: bigint | null;
  fallbackRequiredAmountAtomic?: string | bigint | null;
}

export interface ApprovalRequirementEvaluation {
  isNative: boolean;
  requiresApproval: boolean;
  tokenAddress: `0x${string}` | null;
  spenderAddress: `0x${string}` | null;
  requiredAmount: bigint;
  currentAllowance: bigint;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function isNativeTokenAddress(
  tokenAddress: string | null | undefined
): boolean {
  if (!tokenAddress) return true;
  const normalized = tokenAddress.trim().toLowerCase();
  return (
    normalized === NATIVE_TOKEN_ADDRESS.toLowerCase() ||
    normalized === ZERO_ADDRESS
  );
}

export function evaluateApprovalRequirement(
  input: ApprovalRequirementInput
): ApprovalRequirementEvaluation {
  const candidateToken =
    input.approval?.tokenAddress || input.inputTokenAddress || null;

  if (isNativeTokenAddress(candidateToken)) {
    return {
      isNative: true,
      requiresApproval: false,
      tokenAddress: null,
      spenderAddress: null,
      requiredAmount: 0n,
      currentAllowance: 0n,
    };
  }

  const spenderRaw = input.approval?.spenderAddress?.trim() || '';
  if (!spenderRaw || isNativeTokenAddress(spenderRaw)) {
    return {
      isNative: false,
      requiresApproval: false,
      tokenAddress: candidateToken as `0x${string}`,
      spenderAddress: null,
      requiredAmount: 0n,
      currentAllowance: input.currentAllowance ?? 0n,
    };
  }

  let requiredAmount = 0n;
  try {
    const rawMin =
      input.approval?.amount ??
      input.approval?.minimumAmount ??
      input.fallbackRequiredAmountAtomic ??
      '0';
    requiredAmount =
      typeof rawMin === 'bigint' ? rawMin : BigInt(String(rawMin).trim() || '0');
  } catch {
    requiredAmount = 0n;
  }

  const currentAllowance = input.currentAllowance ?? 0n;
  const requiresApproval =
    requiredAmount > 0n && currentAllowance < requiredAmount;

  return {
    isNative: false,
    requiresApproval,
    tokenAddress: candidateToken as `0x${string}`,
    spenderAddress: spenderRaw as `0x${string}`,
    requiredAmount,
    currentAllowance,
  };
}

export function computeInitialSettlementStep(
  evaluation: ApprovalRequirementEvaluation
): SettlementFlowStep {
  return evaluation.requiresApproval ? 'needs-approval' : 'ready';
}

export type SettlementStepEvent =
  | { type: 'SYNC_ALLOWANCE'; requiresApproval: boolean }
  | { type: 'START_APPROVE' }
  | { type: 'APPROVE_CONFIRMED' }
  | { type: 'START_SEND' }
  | { type: 'TX_SUBMITTED' }
  | { type: 'TX_CONFIRMED' }
  | { type: 'FAIL'; reason: string }
  | { type: 'RESET'; requiresApproval: boolean };

export interface SettlementMachineState {
  step: SettlementFlowStep;
  approvalTxHash: `0x${string}` | null;
  settlementTxHash: `0x${string}` | null;
  errorMessage: string | null;
}

export function createInitialSettlementState(
  requiresApproval: boolean
): SettlementMachineState {
  return {
    step: requiresApproval ? 'needs-approval' : 'ready',
    approvalTxHash: null,
    settlementTxHash: null,
    errorMessage: null,
  };
}

export function transitionSettlementStep(
  state: SettlementMachineState,
  event: SettlementStepEvent,
  hashes?: {
    approvalTxHash?: `0x${string}` | null;
    settlementTxHash?: `0x${string}` | null;
  }
): SettlementMachineState {
  switch (event.type) {
    case 'SYNC_ALLOWANCE': {
      // Only update idle steps when allowance refreshes
      if (
        state.step === 'needs-approval' ||
        state.step === 'ready' ||
        state.step === 'failed'
      ) {
        return {
          ...state,
          step: event.requiresApproval ? 'needs-approval' : 'ready',
          errorMessage: state.step === 'failed' ? state.errorMessage : null,
        };
      }
      return state;
    }
    case 'START_APPROVE':
      return {
        ...state,
        step: 'approving',
        errorMessage: null,
        approvalTxHash: hashes?.approvalTxHash ?? state.approvalTxHash,
      };
    case 'APPROVE_CONFIRMED':
      return {
        ...state,
        step: 'ready',
        errorMessage: null,
        approvalTxHash: hashes?.approvalTxHash ?? state.approvalTxHash,
      };
    case 'START_SEND':
      return {
        ...state,
        step: 'sending',
        errorMessage: null,
      };
    case 'TX_SUBMITTED':
      return {
        ...state,
        step: 'pending',
        errorMessage: null,
        settlementTxHash: hashes?.settlementTxHash ?? state.settlementTxHash,
      };
    case 'TX_CONFIRMED':
      return {
        ...state,
        step: 'confirmed',
        errorMessage: null,
        settlementTxHash: hashes?.settlementTxHash ?? state.settlementTxHash,
      };
    case 'FAIL':
      return {
        ...state,
        step: 'failed',
        errorMessage: event.reason,
      };
    case 'RESET':
      return createInitialSettlementState(event.requiresApproval);
    default:
      return state;
  }
}
