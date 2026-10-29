'use client';

import { useCallback, useEffect, useState } from 'react';
import { erc20Abi } from 'viem';
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import type {
  NormalizedSocketRoute,
  SupportedEvmChainId,
} from '@/types/veilpay';
import {
  createInitialSettlementState,
  evaluateApprovalRequirement,
  transitionSettlementStep,
  type SettlementFlowStep,
  type SettlementMachineState,
} from '@/lib/settlement/approval-machine';

export interface UseSettlementFlowOptions {
  route: NormalizedSocketRoute | null | undefined;
  originChainId: SupportedEvmChainId;
  inputTokenAddress?: string | null;
  ownerAddress?: string | null;
  enabled?: boolean;
  onConfirmed?: (txHash: `0x${string}`) => void;
}

export function useSettlementFlow({
  route,
  originChainId,
  inputTokenAddress,
  ownerAddress,
  enabled = true,
  onConfirmed,
}: UseSettlementFlowOptions) {
  const { chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: originChainId });
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const preliminaryEval = evaluateApprovalRequirement({
    inputTokenAddress,
    approval: route?.approval ?? null,
    currentAllowance: 0n,
  });

  const canReadAllowance =
    enabled &&
    !preliminaryEval.isNative &&
    Boolean(
      ownerAddress &&
        preliminaryEval.tokenAddress &&
        preliminaryEval.spenderAddress
    );

  const { data: onChainAllowance, refetch: refetchAllowance } = useReadContract(
    {
      abi: erc20Abi,
      address: preliminaryEval.tokenAddress ?? undefined,
      functionName: 'allowance',
      args:
        ownerAddress && preliminaryEval.spenderAddress
          ? [ownerAddress as `0x${string}`, preliminaryEval.spenderAddress]
          : undefined,
      chainId: originChainId,
      query: {
        enabled: canReadAllowance,
      },
    }
  );

  const evaluation = evaluateApprovalRequirement({
    inputTokenAddress,
    approval: route?.approval ?? null,
    currentAllowance:
      typeof onChainAllowance === 'bigint' ? onChainAllowance : 0n,
  });

  const [machine, setMachine] = useState<SettlementMachineState>(() =>
    createInitialSettlementState(evaluation.requiresApproval)
  );

  // Sync idle step when route or allowance changes
  useEffect(() => {
    setMachine((prev) =>
      transitionSettlementStep(prev, {
        type: 'SYNC_ALLOWANCE',
        requiresApproval: evaluation.requiresApproval,
      })
    );
  }, [
    evaluation.requiresApproval,
    evaluation.tokenAddress,
    evaluation.spenderAddress,
    route?.txData?.object?.data,
  ]);

  // Also watch settlementTxHash via useWaitForTransactionReceipt
  const { isSuccess: isReceiptConfirmed, isError: isReceiptFailed } =
    useWaitForTransactionReceipt({
      hash: machine.settlementTxHash ?? undefined,
      chainId: originChainId,
      query: {
        enabled: Boolean(machine.settlementTxHash),
      },
    });

  useEffect(() => {
    if (
      isReceiptConfirmed &&
      machine.settlementTxHash &&
      machine.step === 'pending'
    ) {
      setMachine((prev) =>
        transitionSettlementStep(prev, { type: 'TX_CONFIRMED' })
      );
      onConfirmed?.(machine.settlementTxHash);
    } else if (isReceiptFailed && machine.step === 'pending') {
      setMachine((prev) =>
        transitionSettlementStep(prev, {
          type: 'FAIL',
          reason: 'On-chain settlement transaction reverted.',
        })
      );
    }
  }, [
    isReceiptConfirmed,
    isReceiptFailed,
    machine.settlementTxHash,
    machine.step,
    onConfirmed,
  ]);

  const executeApprovalOnly = useCallback(async (): Promise<
    `0x${string}` | null
  > => {
    if (
      !evaluation.requiresApproval ||
      !evaluation.tokenAddress ||
      !evaluation.spenderAddress
    ) {
      setMachine((prev) =>
        transitionSettlementStep(prev, { type: 'APPROVE_CONFIRMED' })
      );
      return null;
    }

    try {
      if (walletChainId !== originChainId && switchChainAsync) {
        await switchChainAsync({ chainId: originChainId });
      }

      setMachine((prev) =>
        transitionSettlementStep(prev, { type: 'START_APPROVE' })
      );

      const approveHash = await writeContractAsync({
        abi: erc20Abi,
        address: evaluation.tokenAddress,
        functionName: 'approve',
        args: [evaluation.spenderAddress, evaluation.requiredAmount],
        chainId: originChainId,
      });

      setMachine((prev) =>
        transitionSettlementStep(
          prev,
          { type: 'START_APPROVE' },
          { approvalTxHash: approveHash }
        )
      );

      if (publicClient) {
        const approveReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveHash,
        });
        if (approveReceipt.status === 'reverted') {
          throw new Error('ERC-20 approve transaction reverted on-chain.');
        }
      }

      await refetchAllowance();
      setMachine((prev) =>
        transitionSettlementStep(
          prev,
          { type: 'APPROVE_CONFIRMED' },
          { approvalTxHash: approveHash }
        )
      );
      return approveHash;
    } catch (err) {
      const reason =
        err instanceof Error
          ? err.message.slice(0, 140)
          : 'ERC-20 token approval failed or was rejected.';
      setMachine((prev) =>
        transitionSettlementStep(prev, { type: 'FAIL', reason })
      );
      throw err;
    }
  }, [
    evaluation,
    originChainId,
    publicClient,
    refetchAllowance,
    switchChainAsync,
    walletChainId,
    writeContractAsync,
  ]);

  const approveIfNeededAndSend = useCallback(async (): Promise<
    `0x${string}` | null
  > => {
    if (!route?.txData?.object) {
      setMachine((prev) =>
        transitionSettlementStep(prev, {
          type: 'FAIL',
          reason: 'No executable route transaction data available.',
        })
      );
      return null;
    }

    try {
      if (walletChainId !== originChainId && switchChainAsync) {
        await switchChainAsync({ chainId: originChainId });
      }

      // Step 1: For non-native ERC-20 tokens, check allowance and approve if needed
      if (
        !evaluation.isNative &&
        evaluation.requiresApproval &&
        evaluation.tokenAddress &&
        evaluation.spenderAddress
      ) {
        await executeApprovalOnly();
      }

      // Step 2: Send the swap / transfer transaction
      setMachine((prev) =>
        transitionSettlementStep(prev, { type: 'START_SEND' })
      );

      const txObj = route.txData.object;
      const txHash = await sendTransactionAsync({
        to: txObj.to as `0x${string}`,
        data: txObj.data as `0x${string}`,
        value: BigInt(txObj.value || '0'),
        chainId: originChainId,
      });

      setMachine((prev) =>
        transitionSettlementStep(
          prev,
          { type: 'TX_SUBMITTED' },
          { settlementTxHash: txHash }
        )
      );

      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        if (receipt.status === 'reverted') {
          throw new Error('Settlement transaction reverted on-chain.');
        }
        setMachine((prev) =>
          transitionSettlementStep(
            prev,
            { type: 'TX_CONFIRMED' },
            { settlementTxHash: txHash }
          )
        );
        onConfirmed?.(txHash);
      }

      return txHash;
    } catch (err) {
      const reason =
        err instanceof Error
          ? err.message.slice(0, 140)
          : 'Transaction rejected or failed in wallet.';
      setMachine((prev) =>
        transitionSettlementStep(prev, { type: 'FAIL', reason })
      );
      return null;
    }
  }, [
    evaluation,
    executeApprovalOnly,
     onConfirmed,
    originChainId,
    publicClient,
    route,
    sendTransactionAsync,
    switchChainAsync,
    walletChainId,
  ]);

  const resetFlow = useCallback(() => {
    setMachine(
      transitionSettlementStep(machine, {
        type: 'RESET',
        requiresApproval: evaluation.requiresApproval,
      })
    );
  }, [evaluation.requiresApproval, machine]);

  return {
    step: machine.step as SettlementFlowStep,
    requiresApproval: evaluation.requiresApproval,
    isNativeToken: evaluation.isNative,
    currentAllowance: evaluation.currentAllowance,
    requiredAllowance: evaluation.requiredAmount,
    spenderAddress: evaluation.spenderAddress,
    approvalTxHash: machine.approvalTxHash,
    settlementTxHash: machine.settlementTxHash,
    errorMessage: machine.errorMessage,
    executeApprovalOnly,
    approveIfNeededAndSend,
    resetFlow,
  };
}
