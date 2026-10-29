'use client';

import { useCallback, useEffect, useState } from 'react';
import { erc20Abi } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import {
  createCctpTransferRecord,
  encodeReceiveMessageCalldata,
  getCctpChainConfig,
  getCctpTransferByBurnTxHash,
  listCctpTransferRecords,
  saveCctpTransferRecord,
  transitionCctpTransfer,
} from '@/lib/cctp';
import { evaluateApprovalRequirement } from '@/lib/settlement/approval-machine';
import { CctpRoute, CctpTransferRecord } from '@/types/veilpay';

export interface UseCctpTransferOptions {
  linkId: string;
  receiverVaultAddress: string;
}

export function useCctpTransfer({ linkId, receiverVaultAddress }: UseCctpTransferOptions) {
  const { address: connectedAddress, chainId: connectedChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [activeTransfer, setActiveTransfer] = useState<CctpTransferRecord | null>(null);
  const [resumableTransfers, setResumableTransfers] = useState<CctpTransferRecord[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const refreshSavedTransfers = useCallback(() => {
    setResumableTransfers(listCctpTransferRecords(linkId));
  }, [linkId]);

  useEffect(() => {
    refreshSavedTransfers();
  }, [refreshSavedTransfers]);

  const updateRecord = useCallback(
    (next: CctpTransferRecord) => {
      const saved = saveCctpTransferRecord(next);
      setActiveTransfer(saved);
      refreshSavedTransfers();
      return saved;
    },
    [refreshSavedTransfers]
  );

  const initFromRoute = useCallback(
    (route: CctpRoute, payerAddress: string): CctpTransferRecord => {
      const record = createCctpTransferRecord({
        linkId,
        payerAddress,
        receiverVaultAddress: (receiverVaultAddress || route.mintRecipientAddress) as `0x${string}`,
        route,
      });
      return updateRecord(record);
    },
    [linkId, receiverVaultAddress, updateRecord]
  );

  const resumeByBurnTxHash = useCallback(
    (burnTxHash: string): CctpTransferRecord | null => {
      const found = getCctpTransferByBurnTxHash(burnTxHash);
      if (found) {
        setActiveTransfer(found);
      }
      return found;
    },
    []
  );

  const pollAttestationUntilReady = useCallback(
    async (record: CctpTransferRecord): Promise<CctpTransferRecord> => {
      if (!record.burnTxHash) {
        throw new Error('Cannot poll attestation without a burnTxHash.');
      }

      let current = transitionCctpTransfer(record, 'ATTESTATION_PENDING');
      updateRecord(current);

      const maxAttempts = 20;
      let delayMs = 2000;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const res = await fetch(
          `/api/cctp/attestation?sourceDomain=${record.sourceDomain}&transactionHash=${record.burnTxHash}`
        );
        if (res.ok) {
          const data = (await res.json()) as {
            state: 'ATTESTED' | 'PENDING' | 'ERROR';
            message?: `0x${string}`;
            attestation?: `0x${string}`;
            nonce?: string;
          };
          if (data.state === 'ATTESTED' && data.message && data.attestation) {
            current = transitionCctpTransfer(current, 'ATTESTED', {
              messageBytes: data.message,
              attestationHex: data.attestation,
              cctpNonce: data.nonce,
            });
            return updateRecord(current);
          }
        }
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs = Math.min(delayMs * 1.5, 8000);
      }

      const failed = transitionCctpTransfer(current, 'FAILED', {
        failureReason: 'Attestation polling window paused; resume from Activity when Circle Iris finishes.',
      });
      return updateRecord(failed);
    },
    [updateRecord]
  );

  const startBurnTransfer = useCallback(
    async (route: CctpRoute): Promise<CctpTransferRecord> => {
      if (!connectedAddress || !walletClient || !publicClient) {
        throw new Error('Connect an EVM wallet before starting a CCTP V2 transfer.');
      }

      setIsBusy(true);
      let current = initFromRoute(route, connectedAddress);

      try {
        if (connectedChainId !== route.sourceChainId && switchChainAsync) {
          await switchChainAsync({ chainId: route.sourceChainId });
        }

        const currentAllowance = await publicClient.readContract({
          address: route.contracts.usdcSource,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [connectedAddress, route.contracts.tokenMessengerV2],
        });

        const approvalCheck = evaluateApprovalRequirement({
          inputTokenAddress: route.contracts.usdcSource,
          approval: {
            tokenAddress: route.contracts.usdcSource,
            spenderAddress: route.contracts.tokenMessengerV2,
            minimumAmount: route.amountInAtomic,
          },
          currentAllowance,
        });

        if (approvalCheck.requiresApproval && approvalCheck.spenderAddress) {
          current = transitionCctpTransfer(current, 'APPROVING');
          updateRecord(current);

          const approvalTxHash = await walletClient.writeContract({
            address: route.contracts.usdcSource,
            abi: erc20Abi,
            functionName: 'approve',
            args: [approvalCheck.spenderAddress, approvalCheck.requiredAmount],
            chain: walletClient.chain,
            account: connectedAddress,
          });

          await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
          current = transitionCctpTransfer(current, 'APPROVING', { approvalTxHash });
          updateRecord(current);
        }

        current = transitionCctpTransfer(current, 'BURN_PENDING');
        updateRecord(current);

        const burnTxHash = await walletClient.sendTransaction({
          account: connectedAddress,
          to: route.burnTxData.to,
          data: route.burnTxData.data,
          value: BigInt(route.burnTxData.value || '0'),
          chain: walletClient.chain,
        });

        current = transitionCctpTransfer(current, 'BURN_PENDING', { burnTxHash });
        updateRecord(current);

        const burnReceipt = await publicClient.waitForTransactionReceipt({ hash: burnTxHash });
        if (burnReceipt.status !== 'success') {
          const failed = transitionCctpTransfer(current, 'FAILED', {
            burnTxHash,
            failureReason: 'CCTP depositForBurn transaction reverted on source chain.',
          });
          return updateRecord(failed);
        }

        current = transitionCctpTransfer(current, 'BURN_CONFIRMED', { burnTxHash });
        updateRecord(current);

        return await pollAttestationUntilReady(current);
      } catch (err) {
        const failed = transitionCctpTransfer(current, 'FAILED', {
          failureReason: err instanceof Error ? err.message : 'CCTP V2 burn step failed',
        });
        return updateRecord(failed);
      } finally {
        setIsBusy(false);
      }
    },
    [
      connectedAddress,
      connectedChainId,
      initFromRoute,
      pollAttestationUntilReady,
      publicClient,
      switchChainAsync,
      updateRecord,
      walletClient,
    ]
  );

  const completeMintOnDestination = useCallback(
    async (burnTxHashOrRecord?: string | CctpTransferRecord): Promise<CctpTransferRecord> => {
      const targetRecord =
        typeof burnTxHashOrRecord === 'string'
          ? getCctpTransferByBurnTxHash(burnTxHashOrRecord)
          : burnTxHashOrRecord ?? activeTransfer;

      if (!targetRecord) {
        throw new Error('No CCTP transfer record found to complete.');
      }
      if (!connectedAddress || !walletClient) {
        throw new Error('Connect wallet (payer or receiver) to complete destination mint.');
      }

      setIsBusy(true);
      let current = targetRecord;

      try {
        if (current.status !== 'ATTESTED' || !current.messageBytes || !current.attestationHex) {
          current = await pollAttestationUntilReady(current);
        }

        if (current.status !== 'ATTESTED' || !current.messageBytes || !current.attestationHex) {
          throw new Error('Circle Iris attestation is not yet complete for this burn transaction.');
        }
        const messageBytes = current.messageBytes;
        const attestationHex = current.attestationHex;

        if (connectedChainId !== current.destinationChainId && switchChainAsync) {
          await switchChainAsync({ chainId: current.destinationChainId });
        }

        const destCfg = getCctpChainConfig(current.destinationChainId);
        if (!destCfg) {
          throw new Error(`Unsupported CCTP destination chainId: ${current.destinationChainId}`);
        }

        current = transitionCctpTransfer(current, 'MINT_PENDING');
        updateRecord(current);

        const receiveCalldata = encodeReceiveMessageCalldata({
          message: messageBytes,
          attestation: attestationHex,
        });

        const mintTxHash = await walletClient.sendTransaction({
          account: connectedAddress,
          to: destCfg.messageTransmitterV2,
          data: receiveCalldata,
          value: BigInt(0),
          chain: walletClient.chain,
        });

        current = transitionCctpTransfer(current, 'MINT_PENDING', { mintTxHash });
        updateRecord(current);

        const verifyRes = await fetch('/api/cctp/verify-mint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destinationChainId: current.destinationChainId,
            mintTxHash,
            expectedRecipient: current.receiverVaultAddress,
            minAmountAtomic: current.netAmountOutAtomic,
          }),
        });

        const verifyData = (await verifyRes.json()) as { verified: boolean; reason?: string };
        if (!verifyRes.ok || !verifyData.verified) {
          const failed = transitionCctpTransfer(current, 'FAILED', {
            mintTxHash,
            failureReason:
              verifyData.reason || 'Destination chain mint verification failed.',
          });
          return updateRecord(failed);
        }

        current = transitionCctpTransfer(current, 'MINTED', { mintTxHash });
        return updateRecord(current);
      } catch (err) {
        const failed = transitionCctpTransfer(current, 'FAILED', {
          failureReason: err instanceof Error ? err.message : 'Destination mint failed',
        });
        return updateRecord(failed);
      } finally {
        setIsBusy(false);
      }
    },
    [
      activeTransfer,
      connectedAddress,
      connectedChainId,
      pollAttestationUntilReady,
      switchChainAsync,
      updateRecord,
      walletClient,
    ]
  );

  return {
    activeTransfer,
    resumableTransfers,
    isBusy,
    initFromRoute,
    resumeByBurnTxHash,
    startBurnTransfer,
    pollAttestationUntilReady,
    completeMintOnDestination,
  };
}
