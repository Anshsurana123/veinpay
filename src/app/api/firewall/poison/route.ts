import { NextRequest, NextResponse } from 'next/server';
import type { VaultSettlementMode } from '@/types/veilpay';
import type { TrustedContactRecord } from '@/lib/graph/seed-topologies';
import { evaluateOutboundPoisonRisk } from '@/lib/graph/poison-guard';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const candidateInput =
    sp.get('address') ||
    sp.get('candidateInput') ||
    '0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B';
  const expectedMode = (sp.get('expectedMode') || 'EVM_SOCKET') as VaultSettlementMode;

  let trustedContacts: TrustedContactRecord[] | undefined;
  const contactsParam = sp.get('contacts') || sp.get('trustedContacts');
  if (contactsParam) {
    try {
      trustedContacts = JSON.parse(contactsParam) as TrustedContactRecord[];
    } catch {
      // Ignore malformed JSON query param
    }
  }

  const result = evaluateOutboundPoisonRisk({
    candidateInput,
    expectedMode,
    trustedContacts,
  });

  return NextResponse.json({
    success: true,
    ...result,
    result,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      candidateInput?: string;
      address?: string;
      expectedMode?: VaultSettlementMode;
      trustedContacts?: TrustedContactRecord[];
    };
    const candidateInput =
      body.candidateInput ??
      body.address ??
      '0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B';
    const expectedMode = body.expectedMode ?? 'EVM_SOCKET';

    const result = evaluateOutboundPoisonRisk({
      candidateInput,
      expectedMode,
      trustedContacts: body.trustedContacts,
    });

    return NextResponse.json({
      success: true,
      ...result,
      result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Invalid PoisonGraph request',
      },
      { status: 400 }
    );
  }
}
