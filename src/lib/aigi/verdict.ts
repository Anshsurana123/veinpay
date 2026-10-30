import { sha256, keccak256, toHex } from 'viem';
import type {
  AigiForensicReceipt,
  FirewallScanResult,
  HopEvidenceStep,
} from '@/types/veilpay';
import { formatShortAddress } from '@/lib/validators/address';
import {
  getCachedGeminiSummary,
  setCachedGeminiSummary,
} from '@/lib/security/scan-cache';
import {
  signReceiptCommitmentHash,
  DEMO_RECEIPT_KEY_ID,
} from '@/lib/aigi/receipt-signer';
import { computePolicyKeccak256 } from '@/lib/links/canonical';

// Pure synchronous SHA-256 wrapper using viem's battle-tested cryptographic primitives
export function sha256HexSync(asciiText: string): string {
  return sha256(toHex(asciiText)).slice(2);
}

export function keccak256HexSync(asciiText: string): string {
  return keccak256(toHex(asciiText));
}

export interface GenerateReceiptOptions {
  linkId?: string;
  payer?: string;
  merchant?: string;
  policyHash?: string;
  graphSnapshot?: string;
  issuedAt?: string;
  expiresAt?: string;
  receiptNonce?: string;
  demo?: boolean;
  unsigned?: boolean;
  schemaVersion?: 'v1' | 'v2';
}

export function generateAigiForensicReceipt(
  scan: FirewallScanResult,
  options?: GenerateReceiptOptions
): AigiForensicReceipt {
  const isDemo = Boolean(options?.demo);

  const vertexMap = new Map(scan.vertices.map((v) => [v.id.toLowerCase(), v]));

  const evidenceChain: HopEvidenceStep[] = scan.evidenceEdges.map((edge) => {
    const hop = edge.attributes.hop_distance;
    const fromV = vertexMap.get(edge.from_id.toLowerCase());
    const toV = vertexMap.get(edge.to_id.toLowerCase());
    const isThreatOrigin = fromV ? fromV.isTainted : false;
    const fromLabel =
      fromV?.label || formatShortAddress(edge.from_id);
    const toLabel =
      toV?.label || formatShortAddress(edge.to_id);
    const fromRiskTag = fromV?.riskTag || 'INTERMEDIATE_MULE';

    let narrative = `Hop ${hop}: Transferred ${edge.attributes.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${edge.attributes.token} ($${edge.attributes.amount_usd.toFixed(2)} USD) from ${fromLabel} to ${toLabel}.`;
    if (isThreatOrigin) {
      narrative = `Hop ${hop} (PRIMARY EXPLOIT TAINT ORIGIN): Taint introduced by ${fromRiskTag} entity [${fromLabel}]. Directed transfer of ${edge.attributes.amount.toLocaleString()} ${edge.attributes.token} ($${edge.attributes.amount_usd.toFixed(2)}) funded downstream intermediary.`;
    }

    return {
      hopNumber: hop,
      fromAddress: edge.from_id,
      fromLabel,
      fromRiskTag,
      toAddress: edge.to_id,
      toLabel,
      txHash: edge.attributes.tx_hash,
      amount: edge.attributes.amount,
      amountUsd: edge.attributes.amount_usd,
      token: edge.attributes.token,
      blockNumber: edge.attributes.block_number,
      timestamp: edge.attributes.timestamp,
      narrative,
    };
  });

  let badgeTitle = 'VERIFIED COMPLIANT';
  let badgeSummary = `0 OFAC/Drainer Taint • ${scan.nodesScanned} Nodes Scanned • TigerGraph Clean`;
  let deterministicNarrative = '';

  if (scan.verdict === 'INTERCEPTED_TAINT') {
    const threatEntity = scan.taintedRootEntities[0];
    const threatDesc = threatEntity
      ? `${threatEntity.label} (${threatEntity.id})`
      : 'Sanctioned / Drainer Vertex';
    badgeTitle = 'INTERCEPTED: EXPLOIT TAINT';
    badgeSummary = `Contagion path: ${scan.minTaintHop} hop(s) from ${threatEntity?.label ?? 'Known Threat'}`;
    deterministicNarrative = `TigerGraph 3-in-1 Pre-Sign Firewall detected illicit funds lineage reaching target wallet ${scan.targetWallet}. Lineage connects to flagged entity ${threatDesc} at hop distance ${scan.minTaintHop}. Access to cross-chain swap quotes and destination settlement URIs is strictly hard-locked.`;
  } else if (scan.verdict === 'INTERCEPTED_SYBIL') {
    badgeTitle = 'INTERCEPTED: SYBIL CLUSTER';
    badgeSummary = `Coordinated cluster size ${scan.sybilClusterSize} (threshold: ${scan.policyApplied.sybilBlockThreshold})`;
    deterministicNarrative = `TigerGraph Unbundle traversal identified target wallet ${scan.targetWallet} as a member of a coordinated ${scan.sybilClusterSize}-address sybil ring sharing root funder ${scan.sybilRootFunder ?? 'Unknown Root'}. Threshold of ${scan.policyApplied.sybilBlockThreshold} was exceeded; transaction execution blocked.`;
  } else if (scan.verdict === 'WARNING_SYBIL') {
    badgeTitle = 'WARNING: SYBIL RING ADVISORY';
    badgeSummary = `Coordinated cluster size ${scan.sybilClusterSize} (below block threshold of ${scan.policyApplied.sybilBlockThreshold})`;
    deterministicNarrative = `TigerGraph Unbundle traversal identified target wallet ${scan.targetWallet} as a member of an unbundled ${scan.sybilClusterSize}-address cluster funded by ${scan.sybilRootFunder ?? 'Root Funder'}. Policy permitted execution with advisory flags.`;
  } else if (scan.verdict === 'INTERCEPTED_POISONING') {
    badgeTitle = 'INTERCEPTED: ADDRESS POISONING';
    badgeSummary = `Target address exhibits dust-factory topology (out-degree: ${scan.dustOutDegree})`;
    deterministicNarrative = `TigerGraph PoisonGraph check detected address poisoning anomaly on ${scan.targetWallet}. The candidate has distributed dust transactions to ${scan.dustOutDegree} vanity-lookalike targets with 0 prior interactions. Cross-chain quote generation locked.`;
  } else if (scan.verdict === 'ADVISORY_BYPASSED') {
    badgeTitle = 'ADVISORY: FIREWALL BYPASS';
    badgeSummary = 'Firewall enforcement disabled by receiver policy';
    deterministicNarrative = `TigerGraph scan completed for ${scan.targetWallet}. The merchant link policy has disabled firewall enforcement; threats were logged for audit compliance but execution was permitted.`;
  } else if (scan.verdict === 'INCONCLUSIVE') {
    const isBlock = (scan.policyApplied.inconclusivePolicy ?? 'BLOCK') === 'BLOCK';
    badgeTitle = isBlock
      ? 'LINEAGE INCONCLUSIVE: BLOCKED BY POLICY'
      : 'LINEAGE INCONCLUSIVE: WARNING ADVISORY';
    badgeSummary = scan.inconclusiveReason
      ? `Inconclusive: ${scan.inconclusiveReason}`
      : `Unable to fully verify lineage (${scan.nodesScanned} Wallets Inspected)`;
    deterministicNarrative = `Lineage inspection returned INCONCLUSIVE for ${scan.targetWallet}. Reason: ${scan.inconclusiveReason ?? 'Incomplete or unverified lineage data'}. Link policy 'inconclusivePolicy' is set to ${scan.policyApplied.inconclusivePolicy ?? 'BLOCK'}, so settlement access is ${isBlock ? 'locked (fail-closed)' : 'unlocked with warning'}.`;
  } else {
    deterministicNarrative = `TigerGraph 3-in-1 Pre-Sign Firewall completed ${scan.maxHopsQueried}-hop backward lineage and sybil cluster inspection on ${scan.targetWallet} in ${scan.executionTimeMs}ms (${scan.nodesScanned} vertices, ${scan.edgesTraversed} directed edges). Confirmed 0 drainer/mixer taint links, 0 sybil bundle violations, and 0 dust-factory anomalies.${scan.shallowScanAdvisory ? ` Note: ${scan.shallowScanAdvisory}` : ''}`;
  }

  // Canonical payload & commitment hash
  const canonicalMetrics = {
    minTaintHop: scan.minTaintHop,
    taintHits: scan.taintHits,
    sybilClusterSize: scan.sybilClusterSize,
    sybilRootFunder: (scan.sybilRootFunder ?? '').toLowerCase(),
    cyclicLoopDetected: scan.cyclicLoopDetected,
    selfTransferDetected: scan.selfTransferDetected,
    dustOutDegree: scan.dustOutDegree,
    nodesScanned: scan.nodesScanned,
    edgesTraversed: scan.edgesTraversed,
  };

  const canonicalEvidence = scan.evidenceEdges.map((e) => ({
    from: e.from_id.toLowerCase(),
    to: e.to_id.toLowerCase(),
    hop: e.attributes.hop_distance,
    txHash: e.attributes.tx_hash.toLowerCase(),
    amount: e.attributes.amount,
    token: e.attributes.token,
  }));

  const metricsHash = `0x${sha256HexSync(JSON.stringify(canonicalMetrics))}`;
  const evidenceHash = `0x${sha256HexSync(JSON.stringify(canonicalEvidence))}`;
  const policyHash =
    options?.policyHash || computePolicyKeccak256(scan.policyApplied);

  const issuedAt = options?.issuedAt || scan.timestamp;
  const expiresAt =
    options?.expiresAt ||
    new Date(Date.parse(scan.timestamp) + 15 * 60 * 1000).toISOString();
  const receiptNonce =
    options?.receiptNonce ||
    `rcpt_nonce_${sha256HexSync(scan.targetWallet + scan.timestamp).slice(0, 16)}`;

  // Support v1 if explicitly requested (for existing legacy test vectors)
  let canonicalPayloadJson: string;
  let canonicalCommitmentObject: Record<string, unknown>;

  const useV2 =
    options?.schemaVersion === 'v2' ||
    (options?.schemaVersion !== 'v1' && Boolean(options?.linkId));

  if (!useV2) {
    canonicalCommitmentObject = {
      schema: 'veilpay.aigi.receipt.v1',
      verdictStatus: scan.verdict,
      targetWallet: scan.targetWallet.toLowerCase(),
      merchantWallet: scan.merchantWallet.toLowerCase(),
      maxHopsQueried: scan.maxHopsQueried,
      policyApplied: {
        firewallEnabled: scan.policyApplied.firewallEnabled,
        maxHops: scan.policyApplied.maxHops,
        cleanLinkEnabled: scan.policyApplied.cleanLinkEnabled,
        unbundleEnabled: scan.policyApplied.unbundleEnabled,
        sybilBlockThreshold: scan.policyApplied.sybilBlockThreshold,
        inconclusivePolicy: scan.policyApplied.inconclusivePolicy ?? 'BLOCK',
      },
      inconclusiveReason: scan.inconclusiveReason ?? null,
      metrics: canonicalMetrics,
      evidenceEdges: canonicalEvidence,
    };
  } else {
    // Standard v2 signed commitment specification
    canonicalCommitmentObject = {
      schema: 'veilpay.aigi.receipt.v2',
      linkId: options?.linkId || 'default',
      payer: (options?.payer || scan.targetWallet).toLowerCase(),
      merchant: (options?.merchant || scan.merchantWallet).toLowerCase(),
      policyHash,
      verdict: scan.verdict,
      metricsHash,
      evidenceHash,
      executionSource: scan.executionSource,
      graphSnapshot: options?.graphSnapshot || scan.timestamp,
      issuedAt,
      expiresAt,
      receiptNonce,
      demo: isDemo,
    };
  }

  canonicalPayloadJson = JSON.stringify(canonicalCommitmentObject);
  const cryptographicAuditHash = `0x${sha256HexSync(canonicalPayloadJson)}`;

  let signature: string | null = null;
  let keyId: string | undefined = undefined;

  if (options?.unsigned) {
    signature = null;
    keyId = undefined;
  } else if (isDemo) {
    const signed = signReceiptCommitmentHash(cryptographicAuditHash, {
      useDemoKey: true,
    });
    signature = signed.signature;
    keyId = signed.keyId;
  } else {
    const signed = signReceiptCommitmentHash(cryptographicAuditHash);
    signature = signed.signature;
    keyId = signed.keyId;
  }

  return {
    receiptId: `VP-AIGI-${cryptographicAuditHash.slice(2, 10).toUpperCase()}`,
    verdictStatus: scan.verdict,
    badgeTitle,
    badgeSummary,
    targetWallet: scan.targetWallet,
    merchantWallet: scan.merchantWallet,
    linkId: options?.linkId || 'default',
    payer: options?.payer || scan.targetWallet,
    merchant: options?.merchant || scan.merchantWallet,
    policyHash,
    metricsHash,
    evidenceHash,
    graphSnapshot: options?.graphSnapshot || scan.timestamp,
    issuedAt,
    expiresAt,
    receiptNonce,
    demo: isDemo,
    inconclusiveReason: scan.inconclusiveReason ?? null,
    telemetry: {
      nodesScanned: scan.nodesScanned,
      edgesTraversed: scan.edgesTraversed,
      maxHopDepth: scan.maxHopsQueried,
      executionTimeMs: scan.executionTimeMs,
      executionSource: scan.executionSource,
      taintHits: scan.taintHits,
      sybilClusterSize: scan.sybilClusterSize,
      dustOutDegree: scan.dustOutDegree,
    },
    evidenceChain,
    deterministicNarrative,
    geminiExecutiveSummary: null,
    geminiModelUsed: null,
    cryptographicAuditHash,
    commitmentHash: cryptographicAuditHash,
    signature,
    keyId,
    canonicalPayloadJson,
    generatedAt: scan.timestamp,
  };
}

export async function maybeEnrichReceiptWithGemini(
  receipt: AigiForensicReceipt
): Promise<AigiForensicReceipt> {
  if (process.env.ENABLE_GEMINI_NARRATION !== 'true') {
    return receipt;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return receipt;

  const receiptHash = receipt.cryptographicAuditHash;
  const cachedSummary = getCachedGeminiSummary(receiptHash);
  if (cachedSummary) {
    return {
      ...receipt,
      geminiExecutiveSummary: cachedSummary,
      geminiModelUsed: 'cached',
    };
  }

  const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    // Sanitize any untrusted strings to prevent prompt injection
    const cleanTarget = receipt.targetWallet.replace(/[^a-zA-Z0-9x]/g, '');
    const cleanVerdict = receipt.verdictStatus.replace(/[^A-Z_]/g, '');
    const cleanNarrative = receipt.deterministicNarrative.slice(0, 500);

    const prompt = [
      'You are the AIGI Web3 Forensic Compliance Narrator for VeilPay.',
      'Write a crisp, institutional 2-sentence executive forensic summary based ONLY on the exact deterministic receipt facts below.',
      'STRICT RULES: Do NOT invent any addresses, hop numbers, or transaction hashes. Cite the exact verdict, hop count, and primary address/hash.',
      `Verdict: ${cleanVerdict}`,
      `Target Payer: ${cleanTarget}`,
      `Telemetry: ${JSON.stringify(receipt.telemetry)}`,
      `Deterministic Narrative: ${cleanNarrative}`,
    ].join('\n');

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 2400)
    );

    const genPromise = ai.models
      .generateContent({
        model: modelName,
        contents: prompt,
      })
      .then((res) => res.text?.trim() || null)
      .catch(() => null);

    const summaryText = await Promise.race([genPromise, timeoutPromise]);
    if (!summaryText) return receipt;

    setCachedGeminiSummary(receiptHash, summaryText, 300_000);

    return {
      ...receipt,
      geminiExecutiveSummary: summaryText,
      geminiModelUsed: modelName,
    };
  } catch {
    return receipt;
  }
}
