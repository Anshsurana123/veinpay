import type { GraphEdge, GraphVertex } from '@/types/veilpay';
import { DEFAULT_CAKE_VAULT_ADDRESSES, toEip55Address } from '@/lib/validators/address';

export interface WalletPersonaPreset {
  id: 'persona-1' | 'persona-2' | 'persona-3' | 'persona-4';
  shortTitle: string;
  badgeText: string;
  address: string;
  shorthandDisplay: string;
  defaultChainId: number;
  defaultTokenSymbol: 'USDC' | 'ETH' | 'USDT';
  description: string;
  expectedOutcomeSummary: string;
}

export const WALLET_PERSONAS: WalletPersonaPreset[] = [
  {
    id: 'persona-1',
    shortTitle: 'Persona 1: Clean Arbitrum Whale',
    badgeText: '0x4F2a...88E1 · CLEAN 3-HOP',
    address: '0x4F2a9c117034e8B1200499A1c3f88200000188E1',
    shorthandDisplay: '0x4F2a...88E1',
    defaultChainId: 42161,
    defaultTokenSymbol: 'USDC',
    description:
      '3 hops of verified institutional DEX & CEX liquidity on Arbitrum (Uniswap V3, Coinbase Institutional, Circle Treasury).',
    expectedOutcomeSummary: 'Passes CleanLink & Unbundle at all hop depths (1–5) → Unlocks SOCKET V3 Quote & Cake Wallet Vault.',
  },
  {
    id: 'persona-2',
    shortTitle: 'Persona 2: 2-Hop Drainer Contagion',
    badgeText: '0x99B1...Dead · HOP-2 TAINT',
    address: '0x99B1c402881a77e3d90123456789aB00000FDead',
    shorthandDisplay: '0x99B1...Dead',
    defaultChainId: 42161,
    defaultTokenSymbol: 'ETH',
    description:
      'Funded via intermediate EOA Mule_1 (Hop 1) by PinkDrainer Exploit Contract (0xdead...0001) at Hop 2.',
    expectedOutcomeSummary:
      'Passes at 1 Hop (with shallow-scan advisory); BLOCKED (INTERCEPTED_TAINT) when max_hops >= 2.',
  },
  {
    id: 'persona-3',
    shortTitle: 'Persona 3: 24-Wallet Sybil Bundle',
    badgeText: '0x5eb1...0014 · 24-SYBIL RING',
    address: '0x5eb1a800112233445566778899aAbb0000010014',
    shorthandDisplay: '0x5eb1...0014',
    defaultChainId: 42161,
    defaultTokenSymbol: 'USDC',
    description:
      'Member of a 24-wallet sybil smurfing ring funded in the same block by Sybil Mother Wallet (0xB055...9999) + cyclic wash loop.',
    expectedOutcomeSummary:
      'Collapses 24 sibling wallets to shared ancestor 0xB055...9999 at Hop 2 → INTERCEPTED_SYBIL.',
  },
  {
    id: 'persona-4',
    shortTitle: 'Persona 4: Deep 4-Hop Historic Taint',
    badgeText: '0x33C0...40b0 · HOP-4 TAINT',
    address: '0x33C077112233445566778899aABbcC00000540b0',
    shorthandDisplay: '0x33C0...40b0',
    defaultChainId: 1,
    defaultTokenSymbol: 'USDC',
    description:
      'Sanctioned Lazarus/Tornado Cash Mixer sits specifically at Hop 4 behind 3 unmarked OTC/layering relays.',
    expectedOutcomeSummary:
      'Passes under default 3 Hops; dynamically switches to INTERCEPTED_TAINT the instant [ 4 Hops ] or [ 5 Hops ] is clicked.',
  },
];

export const OUTBOUND_POISON_TEST_PRESETS = [
  {
    id: 'poison-clone',
    label: 'Test Poisoned Vanity Clone (0x71C894a1...489B)',
    badge: '4,210 DUST TXS · VANITY CLONE',
    address: '0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B',
    description: 'Matches first 6 chars (0x71C8) and last 4 chars (489B) of trusted contact; 0 prior outbound txs; 4,210 dust transfers.',
  },
  {
    id: 'trusted-contact',
    label: 'Test Verified Trusted Contact (0x71C8f3b9...489B)',
    badge: 'PAID 4 TIMES · $18,400 VOL',
    address: '0x71C8f3b98812ABC90123456789ABcdef0003489B',
    description: 'Verified historical partner paid 4 times previously by the merchant vault.',
  },
  {
    id: 'fresh-wallet',
    label: 'Test Fresh Unrelated Wallet (0x22A9c001...771C)',
    badge: 'FIRST-TIME · 0 DUST ACTIVITY',
    address: '0x22A9c0018834dEf011223344556677880004771C',
    description: 'Brand-new legitimate EOA that does not mimic any contact and has 0 dust-factory edges.',
  },
  {
    id: 'wrong-network-sp1',
    label: 'Test Wrong-Network Address (BIP-352 sp1... in EVM Field)',
    badge: 'CASE 4C · PROTOCOL MISMATCH',
    address: DEFAULT_CAKE_VAULT_ADDRESSES.BTC_SILENT_PAYMENT,
    description: 'Tests Case 4C multi-protocol detection when a Bitcoin Silent Payment address is pasted into an EVM payout field.',
  },
] as const;

export interface TrustedContactRecord {
  address: string;
  label: string;
  priorOutboundCount: number;
  lastPaidTimestamp: string;
  totalVolumeUsd: number;
}

export const SEEDED_TRUSTED_CONTACTS: TrustedContactRecord[] = [
  {
    address: '0x71C8f3b98812ABC90123456789ABcdef0003489B',
    label: 'Spearbit / Audit Partner Treasury',
    priorOutboundCount: 4,
    lastPaidTimestamp: '2026-10-21T16:40:00Z',
    totalVolumeUsd: 18400,
  },
  {
    address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
    label: 'Core Protocol Ops Multisig',
    priorOutboundCount: 9,
    lastPaidTimestamp: '2026-10-25T09:15:00Z',
    totalVolumeUsd: 64200,
  },
];

// Generate the 24 deterministic EIP-55 Sybil Sibling addresses for Persona 3
export const SYBIL_SIBLING_ADDRESSES: string[] = Array.from({ length: 24 }, (_, idx) => {
  const num = idx + 1;
  if (num === 14) {
    return '0x5eb1a800112233445566778899aAbb0000010014'; // Persona 3 itself
  }
  const suffix = num.toString().padStart(4, '0');
  return toEip55Address(`5eb1a800112233445566778899aabb000001${suffix}`);
});

export interface SeedGraphDataset {
  vertices: Map<string, GraphVertex>;
  edges: GraphEdge[];
  poisonDustDegreeByAddress: Map<string, number>;
}

export function buildSeededGraphDataset(): SeedGraphDataset {
  const vertices = new Map<string, GraphVertex>();
  const edges: GraphEdge[] = [];
  const poisonDustDegreeByAddress = new Map<string, number>();

  const addVertex = (v: GraphVertex) => {
    vertices.set(v.id.toLowerCase(), v);
  };

  const addEdge = (e: GraphEdge) => {
    edges.push(e);
  };

  // --- Merchant Default Vault ---
  addVertex({
    id: DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET,
    v_type: 'Merchant',
    label: 'Cake Wallet Default EVM Vault',
    riskTag: 'MERCHANT_VAULT',
    hopDistance: -1,
    chainId: 8453,
    isTainted: false,
    firstSeen: '2025-01-10T00:00:00Z',
  });

  // ==========================================================================
  // PERSONA 1: Clean Arbitrum Whale (0x4F2a...88E1) — 3+ Hops Clean
  // ==========================================================================
  const p1 = '0x4F2a9c117034e8B1200499A1c3f88200000188E1';
  const uniPool = '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443';
  const cbHot = '0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43';
  const circleMint = '0x55FE002aeFF02F77364de339a1292923A15844B8';
  const aavePool = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
  const arbBridge = '0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a';

  addVertex({
    id: p1,
    v_type: 'Wallet',
    label: 'Clean Arbitrum Whale (0x4F2a...88E1)',
    riskTag: 'PAYER_TARGET',
    hopDistance: 0,
    chainId: 42161,
    isTainted: false,
    txCount: 412,
    firstSeen: '2024-03-14T08:20:00Z',
  });
  addVertex({
    id: uniPool,
    v_type: 'Wallet',
    label: 'Uniswap V3 USDC/ETH Pool',
    riskTag: 'CLEAN',
    hopDistance: 1,
    chainId: 42161,
    isTainted: false,
  });
  addVertex({
    id: cbHot,
    v_type: 'Wallet',
    label: 'Coinbase Institutional Hot Wallet',
    riskTag: 'CLEAN',
    hopDistance: 1,
    chainId: 42161,
    isTainted: false,
  });
  addVertex({
    id: circleMint,
    v_type: 'Wallet',
    label: 'Circle Treasury USDC Reserve',
    riskTag: 'CLEAN',
    hopDistance: 2,
    chainId: 1,
    isTainted: false,
  });
  addVertex({
    id: aavePool,
    v_type: 'Wallet',
    label: 'Aave V3 Arbitrum Liquidity Pool',
    riskTag: 'CLEAN',
    hopDistance: 2,
    chainId: 42161,
    isTainted: false,
  });
  addVertex({
    id: arbBridge,
    v_type: 'Wallet',
    label: 'Arbitrum Canonical L1->L2 Bridge',
    riskTag: 'CLEAN',
    hopDistance: 3,
    chainId: 42161,
    isTainted: false,
  });

  addEdge({
    id: 'e-p1-hop1-a',
    e_type: 'TRANSFERRED_TO',
    from_id: uniPool,
    from_type: 'Wallet',
    to_id: p1,
    to_type: 'Wallet',
    attributes: {
      amount: 45000,
      amount_usd: 45000,
      token: 'USDC',
      tx_hash: '0x11a4f890e2c3b4d5a6f7081928374655647382910abcdef1234567890abcdef1',
      block_number: 268910120,
      timestamp: '2026-10-27T14:22:10Z',
      hop_distance: 1,
    },
  });
  addEdge({
    id: 'e-p1-hop1-b',
    e_type: 'TRANSFERRED_TO',
    from_id: cbHot,
    from_type: 'Wallet',
    to_id: p1,
    to_type: 'Wallet',
    attributes: {
      amount: 120000,
      amount_usd: 120000,
      token: 'USDC',
      tx_hash: '0x22b5e901f3d4c5e6b7a8192039485766758493021bcdef0123456789abcdef02',
      block_number: 268850400,
      timestamp: '2026-10-26T09:11:45Z',
      hop_distance: 1,
    },
  });
  addEdge({
    id: 'e-p1-hop2-a',
    e_type: 'TRANSFERRED_TO',
    from_id: circleMint,
    from_type: 'Wallet',
    to_id: cbHot,
    to_type: 'Wallet',
    attributes: {
      amount: 500000,
      amount_usd: 500000,
      token: 'USDC',
      tx_hash: '0x33c6f012a4e5d6f7c8b9203140596877869504132cdef0123456789abcdef003',
      block_number: 268710000,
      timestamp: '2026-10-24T19:04:12Z',
      hop_distance: 2,
    },
  });
  addEdge({
    id: 'e-p1-hop2-b',
    e_type: 'TRANSFERRED_TO',
    from_id: aavePool,
    from_type: 'Wallet',
    to_id: uniPool,
    to_type: 'Wallet',
    attributes: {
      amount: 85000,
      amount_usd: 85000,
      token: 'USDC',
      tx_hash: '0x44d70123b5f6e7a8d9c0314251607988970615243def0123456789abcdef0004',
      block_number: 268600110,
      timestamp: '2026-10-23T11:30:00Z',
      hop_distance: 2,
    },
  });
  addEdge({
    id: 'e-p1-hop3-a',
    e_type: 'TRANSFERRED_TO',
    from_id: arbBridge,
    from_type: 'Wallet',
    to_id: aavePool,
    to_type: 'Wallet',
    attributes: {
      amount: 250000,
      amount_usd: 250000,
      token: 'USDC',
      tx_hash: '0x55e81234c6a7f8b9e0d1425362718099081726354ef0123456789abcdef00005',
      block_number: 268400900,
      timestamp: '2026-10-21T07:50:33Z',
      hop_distance: 3,
    },
  });

  // ==========================================================================
  // PERSONA 2: 2-Hop Drainer Contagion (0x99B1...Dead)
  // PinkDrainer (Hop 2) -> Mule_1 (Hop 1) -> Persona 2 (Hop 0)
  // ==========================================================================
  const p2 = '0x99B1c402881a77e3d90123456789aB00000FDead';
  const mule1 = '0x88E2a1004455667788990011223344556677A102';
  const p2CleanPeer = '0x61F4b2001122334455667788990011223344B209';
  const pinkDrainer = '0xdead000000000000000000000000000000000001';

  addVertex({
    id: p2,
    v_type: 'Wallet',
    label: 'Payer 2: 2-Hop Contagion Wallet (0x99B1...Dead)',
    riskTag: 'PAYER_TARGET',
    hopDistance: 0,
    chainId: 42161,
    isTainted: false,
    txCount: 19,
    firstSeen: '2026-10-26T04:10:00Z',
  });
  addVertex({
    id: mule1,
    v_type: 'Wallet',
    label: 'Mule_1 Burner Relay (Unflagged EOA)',
    riskTag: 'INTERMEDIATE_MULE',
    hopDistance: 1,
    chainId: 42161,
    isTainted: false, // Crucial: Mule_1 itself is an unflagged EOA so Hop=1 passes!
    txCount: 6,
    firstSeen: '2026-10-28T11:10:00Z',
  });
  addVertex({
    id: p2CleanPeer,
    v_type: 'Wallet',
    label: 'Camelot DEX Router',
    riskTag: 'CLEAN',
    hopDistance: 1,
    chainId: 42161,
    isTainted: false,
  });
  addVertex({
    id: pinkDrainer,
    v_type: 'ThreatEntity',
    label: 'PinkDrainer Approval Exploit (0xdead...0001)',
    riskTag: 'APPROVAL_DRAINER',
    hopDistance: 2,
    chainId: 1,
    isTainted: true,
    threatSource: 'ScamSniffer / GoPlus Verified Drainer',
  });

  addEdge({
    id: 'e-p2-hop1-mule',
    e_type: 'TRANSFERRED_TO',
    from_id: mule1,
    from_type: 'Wallet',
    to_id: p2,
    to_type: 'Wallet',
    attributes: {
      amount: 4.2,
      amount_usd: 10500,
      token: 'ETH',
      tx_hash: '0x77a92014b8c3d2e1f09876543210fedcba9876543210fedcba98765432109901',
      block_number: 21045912,
      timestamp: '2026-10-28T11:19:05Z',
      hop_distance: 1,
      is_taint_path: true,
    },
  });
  addEdge({
    id: 'e-p2-hop1-clean',
    e_type: 'TRANSFERRED_TO',
    from_id: p2CleanPeer,
    from_type: 'Wallet',
    to_id: p2,
    to_type: 'Wallet',
    attributes: {
      amount: 320,
      amount_usd: 320,
      token: 'USDC',
      tx_hash: '0x77b92014b8c3d2e1f09876543210fedcba9876543210fedcba98765432109902',
      block_number: 21045100,
      timestamp: '2026-10-27T18:02:19Z',
      hop_distance: 1,
    },
  });
  addEdge({
    id: 'e-p2-hop2-drainer',
    e_type: 'TRANSFERRED_TO',
    from_id: pinkDrainer,
    from_type: 'ThreatEntity',
    to_id: mule1,
    to_type: 'Wallet',
    attributes: {
      amount: 14.5,
      amount_usd: 36250,
      token: 'ETH',
      tx_hash: '0x88f1c9a0e4b2718293049586716253445566778899aabbccddeeff0011223301',
      block_number: 21045890,
      timestamp: '2026-10-28T11:14:22Z',
      hop_distance: 2,
      is_taint_path: true,
    },
  });

  // ==========================================================================
  // PERSONA 3: 24-Wallet Sybil Bundle & Cyclic Wash Ring (0x5eb1...0014)
  // Sybil Mother (0xB055...9999) at Hop 2 -> Sybil Relay Alpha (Hop 1) -> 24 Siblings
  // Plus Cyclic Wash Ring: 0014 -> 0015 -> 0016 -> 0014 and Self-Transfer 0014 -> 0014
  // ==========================================================================
  const p3 = '0x5eb1a800112233445566778899aAbb0000010014';
  const sybilRelayA = toEip55Address('5eb100000000000000000000000000000000a001');
  const sybilMother = '0xB055000000000000000000000000000000019999';
  const washPeer15 = SYBIL_SIBLING_ADDRESSES[14]; // #0015
  const washPeer16 = SYBIL_SIBLING_ADDRESSES[15]; // #0016

  addVertex({
    id: sybilMother,
    v_type: 'Wallet',
    label: 'Sybil Mother Funder (0xB055...9999)',
    riskTag: 'SYBIL_ROOT_FUNDER',
    hopDistance: 2,
    chainId: 42161,
    isTainted: false,
    isSybilRoot: true,
    txCount: 148,
    firstSeen: '2026-10-28T09:00:00Z',
  });
  addVertex({
    id: sybilRelayA,
    v_type: 'Wallet',
    label: 'Sybil Disperse.app Batch Relay',
    riskTag: 'INTERMEDIATE_MULE',
    hopDistance: 1,
    chainId: 42161,
    isTainted: false,
    isSybilRoot: true,
    txCount: 26,
    firstSeen: '2026-10-28T09:01:00Z',
  });

  // Add all 24 Sybil Sibling vertices and batch-funding edges
  SYBIL_SIBLING_ADDRESSES.forEach((sibAddr, index) => {
    const num = index + 1;
    const isTarget = sibAddr.toLowerCase() === p3.toLowerCase();
    const isWashNode =
      isTarget ||
      sibAddr.toLowerCase() === washPeer15.toLowerCase() ||
      sibAddr.toLowerCase() === washPeer16.toLowerCase();

    addVertex({
      id: sibAddr,
      v_type: 'Wallet',
      label: isTarget
        ? 'Persona 3: Sybil Child #14 (0x5eb1...0014)'
        : `Sybil Bundle Sibling #${num.toString().padStart(2, '0')} (${sibAddr.slice(0, 6)}...${sibAddr.slice(-4)})`,
      riskTag: isTarget ? 'PAYER_TARGET' : isWashNode ? 'WASH_CYCLE_NODE' : 'SYBIL_SIBLING',
      hopDistance: isTarget ? 0 : 2,
      chainId: 42161,
      isTainted: false,
      isSybilSibling: true,
      isCyclicMember: isWashNode,
    });

    // Sybil Relay Alpha funds each of the 24 sibling wallets in the same block #21048100
    addEdge({
      id: `e-sybil-fanout-${num}`,
      e_type: 'TRANSFERRED_TO',
      from_id: sybilRelayA,
      from_type: 'Wallet',
      to_id: sibAddr,
      to_type: 'Wallet',
      attributes: {
        amount: 250,
        amount_usd: 250,
        token: 'USDC',
        tx_hash: `0x5eb1b05599990000111122223333444455556666777788889999aabbccdd${num.toString().padStart(4, '0')}`,
        block_number: 21048100,
        timestamp: '2026-10-28T09:02:14Z',
        hop_distance: isTarget ? 1 : 2,
        is_sybil_fanout: true,
      },
    });
  });

  // Sybil Mother -> Sybil Relay Alpha (Hop 2 from Persona 3)
  addEdge({
    id: 'e-sybil-mother-to-relay',
    e_type: 'TRANSFERRED_TO',
    from_id: sybilMother,
    from_type: 'Wallet',
    to_id: sybilRelayA,
    to_type: 'Wallet',
    attributes: {
      amount: 6000,
      amount_usd: 6000,
      token: 'USDC',
      tx_hash: '0xb05599990000111122223333444455556666777788889999aabbccddeeff0000',
      block_number: 21048098,
      timestamp: '2026-10-28T09:01:48Z',
      hop_distance: 2,
      is_sybil_fanout: true,
    },
  });

  // Case 2: Cyclic Wash-Trading Loop (p3 <- washPeer15 <- washPeer16 <- p3)
  addEdge({
    id: 'e-cycle-15-to-14',
    e_type: 'TRANSFERRED_TO',
    from_id: washPeer15,
    from_type: 'Wallet',
    to_id: p3,
    to_type: 'Wallet',
    attributes: {
      amount: 249.5,
      amount_usd: 249.5,
      token: 'USDC',
      tx_hash: '0xc1c1e000111122223333444455556666777788889999aabbccddeeff00000015',
      block_number: 21048112,
      timestamp: '2026-10-28T09:05:10Z',
      hop_distance: 1,
      is_cyclic_edge: true,
    },
  });
  addEdge({
    id: 'e-cycle-16-to-15',
    e_type: 'TRANSFERRED_TO',
    from_id: washPeer16,
    from_type: 'Wallet',
    to_id: washPeer15,
    to_type: 'Wallet',
    attributes: {
      amount: 249.5,
      amount_usd: 249.5,
      token: 'USDC',
      tx_hash: '0xc1c1e000111122223333444455556666777788889999aabbccddeeff00000016',
      block_number: 21048109,
      timestamp: '2026-10-28T09:04:30Z',
      hop_distance: 2,
      is_cyclic_edge: true,
    },
  });
  addEdge({
    id: 'e-cycle-14-to-16',
    e_type: 'TRANSFERRED_TO',
    from_id: p3,
    from_type: 'Wallet',
    to_id: washPeer16,
    to_type: 'Wallet',
    attributes: {
      amount: 249.5,
      amount_usd: 249.5,
      token: 'USDC',
      tx_hash: '0xc1c1e000111122223333444455556666777788889999aabbccddeeff00000014',
      block_number: 21048105,
      timestamp: '2026-10-28T09:03:55Z',
      hop_distance: 3,
      is_cyclic_edge: true,
    },
  });

  // Case 2: Self-Transfer Edge (p3 -> p3)
  addEdge({
    id: 'e-self-transfer-p3',
    e_type: 'TRANSFERRED_TO',
    from_id: p3,
    from_type: 'Wallet',
    to_id: p3,
    to_type: 'Wallet',
    attributes: {
      amount: 10,
      amount_usd: 10,
      token: 'USDC',
      tx_hash: '0x5e1f0000111122223333444455556666777788889999aabbccddeeff00000014',
      block_number: 21048115,
      timestamp: '2026-10-28T09:06:00Z',
      hop_distance: 1,
      is_cyclic_edge: true,
    },
  });

  // ==========================================================================
  // PERSONA 4: Deep 4-Hop Historic Taint (0x33C0...40b0)
  // Sanctioned Mixer (Hop 4) -> Hop3_Relay -> Hop2_Relay -> Hop1_OTC -> Persona 4 (Hop 0)
  // ==========================================================================
  const p4 = '0x33C077112233445566778899aABbcC00000540b0';
  const p4Hop1 = toEip55Address('11a0000000000000000000000000000000000001');
  const p4Hop2 = toEip55Address('22b0000000000000000000000000000000000002');
  const p4Hop3 = toEip55Address('33c0000000000000000000000000000000000003');
  const lazarusMixer = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96';

  addVertex({
    id: p4,
    v_type: 'Wallet',
    label: 'Persona 4: Deep 4-Hop Payer (0x33C0...40b0)',
    riskTag: 'PAYER_TARGET',
    hopDistance: 0,
    chainId: 1,
    isTainted: false,
    txCount: 84,
    firstSeen: '2025-11-02T10:00:00Z',
  });
  addVertex({
    id: p4Hop1,
    v_type: 'Wallet',
    label: 'Hop 1: OTC Settlement Desk EOA',
    riskTag: 'INTERMEDIATE_MULE',
    hopDistance: 1,
    chainId: 1,
    isTainted: false,
  });
  addVertex({
    id: p4Hop2,
    v_type: 'Wallet',
    label: 'Hop 2: Cross-Chain Liquidity Relay',
    riskTag: 'INTERMEDIATE_MULE',
    hopDistance: 2,
    chainId: 1,
    isTainted: false,
  });
  addVertex({
    id: p4Hop3,
    v_type: 'Wallet',
    label: 'Hop 3: Layering Burner Wallet',
    riskTag: 'INTERMEDIATE_MULE',
    hopDistance: 3,
    chainId: 1,
    isTainted: false,
  });
  addVertex({
    id: lazarusMixer,
    v_type: 'ThreatEntity',
    label: 'Hop 4: Tornado Cash / Lazarus Sanctioned Mixer',
    riskTag: 'SANCTIONED_MIXER',
    hopDistance: 4,
    chainId: 1,
    isTainted: true,
    threatSource: 'OFAC SDN List / GoPlus Sanctioned Entity',
  });

  addEdge({
    id: 'e-p4-hop1',
    e_type: 'TRANSFERRED_TO',
    from_id: p4Hop1,
    from_type: 'Wallet',
    to_id: p4,
    to_type: 'Wallet',
    attributes: {
      amount: 12500,
      amount_usd: 12500,
      token: 'USDC',
      tx_hash: '0x4001aaaa111122223333444455556666777788889999aabbccddeeff00004001',
      block_number: 21042100,
      timestamp: '2026-10-27T21:15:00Z',
      hop_distance: 1,
      is_taint_path: true,
    },
  });
  addEdge({
    id: 'e-p4-hop2',
    e_type: 'TRANSFERRED_TO',
    from_id: p4Hop2,
    from_type: 'Wallet',
    to_id: p4Hop1,
    to_type: 'Wallet',
    attributes: {
      amount: 15000,
      amount_usd: 15000,
      token: 'USDC',
      tx_hash: '0x4002bbbb111122223333444455556666777788889999aabbccddeeff00004002',
      block_number: 21041800,
      timestamp: '2026-10-27T19:40:12Z',
      hop_distance: 2,
      is_taint_path: true,
    },
  });
  addEdge({
    id: 'e-p4-hop3',
    e_type: 'TRANSFERRED_TO',
    from_id: p4Hop3,
    from_type: 'Wallet',
    to_id: p4Hop2,
    to_type: 'Wallet',
    attributes: {
      amount: 25000,
      amount_usd: 25000,
      token: 'ETH',
      tx_hash: '0x4003cccc111122223333444455556666777788889999aabbccddeeff00004003',
      block_number: 21040200,
      timestamp: '2026-10-27T14:08:50Z',
      hop_distance: 3,
      is_taint_path: true,
    },
  });
  addEdge({
    id: 'e-p4-hop4-mixer',
    e_type: 'TRANSFERRED_TO',
    from_id: lazarusMixer,
    from_type: 'ThreatEntity',
    to_id: p4Hop3,
    to_type: 'Wallet',
    attributes: {
      amount: 100,
      amount_usd: 250000,
      token: 'ETH',
      tx_hash: '0x4004dddd111122223333444455556666777788889999aabbccddeeff00004004',
      block_number: 21038900,
      timestamp: '2026-10-26T23:51:10Z',
      hop_distance: 4,
      is_taint_path: true,
    },
  });

  // ==========================================================================
  // POISONGRAPH OUTBOUND GUARD TOPOLOGIES (CASE 4A & 4B)
  // ==========================================================================
  const trustedPartner = '0x71C8f3b98812ABC90123456789ABcdef0003489B';
  const poisonedClone = '0x71C894a1B2c3D4e5F6A7b8C9d0e1F2a30000489B';
  const freshRecipient = '0x22A9c0018834dEf011223344556677880004771C';

  addVertex({
    id: trustedPartner,
    v_type: 'Wallet',
    label: 'Trusted Contact: Audit Partner (0x71C8f3b9...489B)',
    riskTag: 'TRUSTED_CONTACT',
    hopDistance: 1,
    chainId: 8453,
    isTainted: false,
    dustOutDegree: 0,
    txCount: 64,
  });
  addVertex({
    id: poisonedClone,
    v_type: 'ThreatEntity',
    label: 'Vanity Poisoning Dust Factory (0x71C894a1...489B)',
    riskTag: 'POISON_DUST_FACTORY',
    hopDistance: 1,
    chainId: 8453,
    isTainted: true,
    dustOutDegree: 4210,
    txCount: 4210,
    threatSource: 'TigerGraph PoisonGraph Out-Degree Anomaly',
  });
  addVertex({
    id: freshRecipient,
    v_type: 'Wallet',
    label: 'Fresh Verified Recipient (0x22A9c001...771C)',
    riskTag: 'CLEAN',
    hopDistance: 1,
    chainId: 8453,
    isTainted: false,
    dustOutDegree: 0,
    txCount: 3,
  });

  poisonDustDegreeByAddress.set(poisonedClone.toLowerCase(), 4210);
  poisonDustDegreeByAddress.set(trustedPartner.toLowerCase(), 0);
  poisonDustDegreeByAddress.set(freshRecipient.toLowerCase(), 0);

  // Add sample DUSTED edges from poisonedClone so graph traversal inspects real dust edges
  for (let d = 1; d <= 8; d++) {
    const victimAddr =
      d === 1
        ? DEFAULT_CAKE_VAULT_ADDRESSES.EVM_SOCKET
        : toEip55Address(`900000000000000000000000000000000000000${d}`);
    if (!vertices.has(victimAddr.toLowerCase())) {
      addVertex({
        id: victimAddr,
        v_type: 'Wallet',
        label: `Dust Target Victim #${d}`,
        riskTag: 'CLEAN',
        hopDistance: 1,
        chainId: 8453,
        isTainted: false,
      });
    }
    addEdge({
      id: `e-poison-dust-${d}`,
      e_type: 'DUSTED',
      from_id: poisonedClone,
      from_type: 'ThreatEntity',
      to_id: victimAddr,
      to_type: 'Wallet',
      attributes: {
        amount: 0.00001,
        amount_usd: 0.00001,
        token: 'USDC',
        tx_hash: `0xd057fa0000111122223333444455556666777788889999aabbccddeeff00000${d}`,
        block_number: 21049000 + d,
        timestamp: `2026-10-28T10:1${d}:00Z`,
        hop_distance: 1,
        is_dust: true,
      },
    });
  }

  return { vertices, edges, poisonDustDegreeByAddress };
}
