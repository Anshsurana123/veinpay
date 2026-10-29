import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { verifyCctpMintOnDestination } from '@/lib/cctp/attestation';
import { isSupportedCctpTestnetChain } from '@/lib/cctp/contracts';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      destinationChainId?: number;
      mintTxHash?: string;
      expectedRecipient?: string;
      expectedReceiverAddress?: string;
      minAmountAtomic?: string;
    };

    const destinationChainId = Number(body.destinationChainId ?? 0);
    const mintTxHash = body.mintTxHash ?? '';
    const expectedRecipient =
      body.expectedReceiverAddress ?? body.expectedRecipient ?? '';
    const minAmountAtomic = body.minAmountAtomic ?? '1';

    if (!isSupportedCctpTestnetChain(destinationChainId)) {
      return NextResponse.json(
        { error: 'Unsupported CCTP V2 testnet destinationChainId.' },
        { status: 400 }
      );
    }

    if (!/^0x[0-9a-fA-F]{64}$/.test(mintTxHash)) {
      return NextResponse.json(
        { error: 'Valid 32-byte hex mintTxHash is required.' },
        { status: 400 }
      );
    }

    if (!isAddress(expectedRecipient)) {
      return NextResponse.json(
        { error: 'Valid expectedRecipient EVM address is required.' },
        { status: 400 }
      );
    }

    const minAmountBigInt =
      /^\d+$/.test(minAmountAtomic) && BigInt(minAmountAtomic) > BigInt(0)
        ? BigInt(minAmountAtomic)
        : BigInt(1);

    const verification = await verifyCctpMintOnDestination({
      destinationChainId,
      mintTxHash: mintTxHash as `0x${string}`,
      expectedReceiverAddress: expectedRecipient as `0x${string}`,
      expectedMinNetAmountAtomic: minAmountBigInt,
    });

    if (!verification.verified) {
      return NextResponse.json(verification, { status: 422 });
    }

    return NextResponse.json(verification, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        verified: false,
        reason: err instanceof Error ? err.message : 'Failed to verify CCTP mint receipt',
      },
      { status: 500 }
    );
  }
}
