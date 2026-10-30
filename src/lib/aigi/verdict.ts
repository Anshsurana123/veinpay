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
import { signReceiptCommitmentHash } from '@/lib/aigi/receipt-signer';

// ============================================================================
// 1. PURE SYNCHRONOUS SHA-256 (FIPS 180-4) FOR DETERMINISTIC RECEIPT COMMITMENT
// ============================================================================

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256HexSync(asciiText: string): string {
  const bytes = new TextEncoder().encode(asciiText);
  const bitLen = bytes.length * 8;
  const padLen = ((56 - ((bytes.length + 1) % 64)) + 64) % 64;
  const totalLen = bytes.length + 1 + padLen + 8;
  const buf = new Uint8Array(totalLen);
  buf.set(bytes, 0);
  buf[bytes.length] = 0x80;

  const view = new DataView(buf.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 =
        rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

// ============================================================================
// 2. DETERMINISTIC AIGI FORENSIC VERDICT & RECEIPT GENERATOR
// ============================================================================

export function generateAigiForensicReceipt(
  scan: FirewallScanResult
): AigiForensicReceipt {
  const vertexById = new Map(
    scan.vertices.map((v) => [v.id.toLowerCase(), v])
  );

  // Build deterministic Hop-by-Hop Evidence Chain
  const evidenceChain: HopEvidenceStep[] = scan.evidenceEdges.map((edge) => {
    const fromV = vertexById.get(edge.from_id.toLowerCase());
    const toV = vertexById.get(edge.to_id.toLowerCase());
    const fromLabel = fromV?.label ?? formatShortAddress(edge.from_id);
    const toLabel = toV?.label ?? formatShortAddress(edge.to_id);
    const fromRiskTag = fromV?.riskTag ?? 'CLEAN';

    const hop = edge.attributes.hop_distance;
    const txShort = `${edge.attributes.tx_hash.slice(0, 10)}...${edge.attributes.tx_hash.slice(-6)}`;

    let narrative = `Hop ${hop}: ${fromLabel} (${formatShortAddress(edge.from_id)}) transferred ${edge.attributes.amount} ${edge.attributes.token} ($${edge.attributes.amount_usd.toLocaleString()}) to ${toLabel} (${formatShortAddress(edge.to_id)}) via Tx ${txShort} at Block #${edge.attributes.block_number}.`;

    if (edge.attributes.is_taint_path && fromV?.isTainted && fromV.v_type === 'ThreatEntity') {
      narrative = `[CRITICAL TAINT ROOT @ HOP ${hop}] ${fromLabel} (${edge.from_id}) injected ${edge.attributes.amount} ${edge.attributes.token} ($${edge.attributes.amount_usd.toLocaleString()}) into ${toLabel} (${formatShortAddress(edge.to_id)}) via Tx ${edge.attributes.tx_hash}.`;
    } else if (edge.attributes.is_sybil_fanout) {
      narrative = `[SYBIL FAN-OUT @ HOP ${hop}] ${fromLabel} (${formatShortAddress(edge.from_id)}) batch-funded ${toLabel} (${formatShortAddress(edge.to_id)}) with ${edge.attributes.amount} ${edge.attributes.token} in synchronized Block #${edge.attributes.block_number} (Tx ${txShort}).`;
    } else if (edge.attributes.is_cyclic_edge) {
      narrative = `[CYCLIC WASH LOOP @ HOP ${hop}] Circular transfer of ${edge.attributes.amount} ${edge.attributes.token} from ${formatShortAddress(edge.from_id)} to ${formatShortAddress(edge.to_id)} via Tx ${txShort}.`;
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

  // Build deterministic badge title, summary, and full forensic narrative
  let badgeTitle = 'VERIFIED CLEAN LINEAGE';
  let badgeSummary = `Verified Clean Across ${scan.maxHopsQueried} ${scan.maxHopsQueried === 1 ? 'Hop' : 'Hops'} (${scan.nodesScanned} Wallets Inspected)`;
  let deterministicNarrative = '';

  if (scan.verdict === 'INTERCEPTED_TAINT') {
    const primaryThreat = scan.taintedRootEntities[0];
    const threatHop = scan.minTaintHop ?? 1;
    const threatLabel = primaryThreat?.label ?? 'Flagged Exploit/Drainer';
    const threatAddr = primaryThreat?.id ?? '0xdead...0001';
    const firstTaintEdge = scan.evidenceEdges.find((e) => e.attributes.is_taint_path);

    badgeTitle = `FIREWALL INTERCEPTED: ${threatHop}-HOP TAINT CONTAGION`;
    badgeSummary = `Blocked: ${threatHop}-Hop Lineage Link to ${threatLabel} (${formatShortAddress(threatAddr)})`;
    deterministicNarrative = `CleanLink multi-hop backward traversal intercepted ${scan.taintHits} upstream threat ${scan.taintHits === 1 ? 'entity' : 'entities'} within ${scan.maxHopsQueried} hops of payer ${scan.targetWallet}. Root contagion originates at Hop ${threatHop} from ${threatLabel} (${threatAddr})${firstTaintEdge ? ` via transaction ${firstTaintEdge.attributes.tx_hash} ($${firstTaintEdge.attributes.amount_usd.toLocaleString()} ${firstTaintEdge.attributes.token})` : ''}. SOCKET cross-chain calldata generation and Cake Wallet settlement URIs are hard-locked (HTTP 403 Firewall Policy).`;
  } else if (scan.verdict === 'INTERCEPTED_SYBIL') {
    const rootAddr = scan.sybilRootFunder ?? 'Shared Root Funder';
    badgeTitle = `FIREWALL INTERCEPTED: ${scan.sybilClusterSize}-WALLET SYBIL BUNDLE`;
    badgeSummary = `Unbundle Blocked: Payer belongs to a ${scan.sybilClusterSize}-wallet sybil cluster funded by ${formatShortAddress(rootAddr)}`;
    deterministicNarrative = `Unbundle topological cluster analysis collapsed ${scan.sybilClusterSize} sibling wallets sharing common ancestor ${rootAddr} within ${scan.maxHopsQueried} hops (exceeding policy block threshold of ${scan.policyApplied.sybilBlockThreshold} linked wallets)${scan.cyclicLoopDetected ? `, compounded by cyclic wash-trading loop activity (${scan.detectedCyclePaths.length} cycle paths detected)` : ''}. SOCKET transaction routing is locked.`;
  } else if (scan.verdict === 'WARNING_SYBIL') {
    badgeTitle = 'UNBUNDLE ADVISORY: SHARED ANCESTOR / WASH LOOP';
    badgeSummary = `Amber Advisory: Cluster size ${scan.sybilClusterSize} (below block threshold ${scan.policyApplied.sybilBlockThreshold})${scan.cyclicLoopDetected ? ' · Cyclic Wash Loop Flagged' : ''}`;
    deterministicNarrative = `Unbundle detected a ${scan.sybilClusterSize}-wallet cluster${scan.cyclicLoopDetected ? ' and circular transfer loop' : ''} within ${scan.maxHopsQueried} hops of ${scan.targetWallet}. Because cluster size is below the strict block threshold (${scan.policyApplied.sybilBlockThreshold}), transaction execution remains unlocked with an active compliance advisory.`;
  } else if (scan.verdict === 'INTERCEPTED_POISONING') {
    badgeTitle = `POISONGRAPH INTERCEPT: ${scan.dustOutDegree.toLocaleString()} DUST TRANSFERS`;
    badgeSummary = `Blocked: High-Out-Degree Vanity Dusting Factory (${scan.dustOutDegree.toLocaleString()} zero/micro-dust edges)`;
    deterministicNarrative = `PoisonGraph detected ${scan.dustOutDegree.toLocaleString()} outbound zero/micro-value dust transfers (<= $0.01) originating from ${scan.targetWallet}. Wallet is classified as an automated address-poisoning factory and is hard-blocked.`;
  } else if (scan.verdict === 'ADVISORY_BYPASSED') {
    badgeTitle = 'POLICY BYPASSED: FIREWALL MASTER TOGGLE OFF';
    badgeSummary = `Advisory Only: Firewall enforcement disabled by receiver (${scan.taintHits} taint hits, ${scan.sybilClusterSize} sybil size observed)`;
    deterministicNarrative = `Master Firewall Toggle is currently OFF. TigerGraph traversal still inspected ${scan.nodesScanned} vertices and ${scan.edgesTraversed} edges across ${scan.maxHopsQueried} hops (recording ${scan.taintHits} taint hits and sybil cluster size ${scan.sybilClusterSize}), but enforcement is bypassed to permit SOCKET quote generation.`;
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

  // Canonical JSON payload for deterministic SHA-256 commitment hash
  // Excludes wall-clock timestamps and executionTimeMs so identical graph state + policy ALWAYS hashes identically!
  const canonicalCommitmentObject = {
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
    metrics: {
      minTaintHop: scan.minTaintHop,
      taintHits: scan.taintHits,
      sybilClusterSize: scan.sybilClusterSize,
      sybilRootFunder: (scan.sybilRootFunder ?? '').toLowerCase(),
      cyclicLoopDetected: scan.cyclicLoopDetected,
      selfTransferDetected: scan.selfTransferDetected,
      dustOutDegree: scan.dustOutDegree,
      nodesScanned: scan.nodesScanned,
      edgesTraversed: scan.edgesTraversed,
    },
    evidenceEdges: scan.evidenceEdges.map((e) => ({
      from: e.from_id.toLowerCase(),
      to: e.to_id.toLowerCase(),
      hop: e.attributes.hop_distance,
      txHash: e.attributes.tx_hash.toLowerCase(),
      amount: e.attributes.amount,
      token: e.attributes.token,
    })),
  };

  const canonicalPayloadJson = JSON.stringify(canonicalCommitmentObject);
  const cryptographicAuditHash = `0x${sha256HexSync(canonicalPayloadJson)}`;
  const { signature, keyId } = signReceiptCommitmentHash(cryptographicAuditHash);

  return {
    receiptId: `VP-AIGI-${cryptographicAuditHash.slice(2, 10).toUpperCase()}`,
    verdictStatus: scan.verdict,
    badgeTitle,
    badgeSummary,
    targetWallet: scan.targetWallet,
    merchantWallet: scan.merchantWallet,
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

// ============================================================================
// 3. OPTIONAL GEMINI NARRATION ENRICHMENT (STRICTLY CONSTRAINED TO EVIDENCE)
// ============================================================================

export async function maybeEnrichReceiptWithGemini(
  receipt: AigiForensicReceipt
): Promise<AigiForensicReceipt> {
  // Server flag gate: require ENABLE_GEMINI_NARRATION=true to prevent accidental credit spending
  if (process.env.ENABLE_GEMINI_NARRATION !== 'true') {
    return receipt;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return receipt;

  // Check summary cache keyed by receipt commitment hash
  const receiptHash = receipt.cryptographicAuditHash;
  const cachedSummary = getCachedGeminiSummary(receiptHash);
  if (cachedSummary) {
    return {
      ...receipt,
      geminiExecutiveSummary: cachedSummary,
      geminiModelUsed: 'cached',
    };
  }

  const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    const prompt = [
      'You are the AIGI (AI Grants India) Web3 Forensic Compliance Narrator for VeilPay.',
      'Write a crisp, institutional 2-sentence executive forensic summary based ONLY on the exact deterministic receipt facts below.',
      'STRICT RULES: Do NOT invent any addresses, hop numbers, or transaction hashes. Cite the exact verdict, hop count, and primary address/hash.',
      `Verdict: ${receipt.verdictStatus}`,
      `Target Payer: ${receipt.targetWallet}`,
      `Telemetry: ${JSON.stringify(receipt.telemetry)}`,
      `Deterministic Narrative: ${receipt.deterministicNarrative}`,
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

    // Cache summary by receipt hash for subsequent requests
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
