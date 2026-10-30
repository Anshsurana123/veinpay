import type {
  CharDiffSegment,
  OutboundPoisonScanResult,
  VaultSettlementMode,
} from '@/types/veilpay';
import {
  DEMO_ADDRESS_ALIASES,
  validateMultiProtocolAddress,
} from '@/lib/validators/address';
import {
  buildSeededGraphDataset,
  SEEDED_TRUSTED_CONTACTS,
  type TrustedContactRecord,
} from '@/lib/graph/seed-topologies';

export function buildCharacterDiffGrid(
  candidateAddress: string,
  trustedAddress: string
): {
  grid: CharDiffSegment[];
  matchingPrefixChars: number;
  matchingSuffixChars: number;
  forgedMiddleChars: number;
} {
  const cand = candidateAddress.trim();
  const trust = trustedAddress.trim();
  const len = Math.min(cand.length, trust.length);

  // Measure contiguous matching prefix (case-insensitive hex comparison after '0x')
  let prefixLen = 0;
  while (
    prefixLen < len &&
    cand[prefixLen].toLowerCase() === trust[prefixLen].toLowerCase()
  ) {
    prefixLen++;
  }

  // Measure contiguous matching suffix from the right
  let suffixLen = 0;
  while (
    suffixLen < len - prefixLen &&
    cand[len - 1 - suffixLen].toLowerCase() ===
      trust[len - 1 - suffixLen].toLowerCase()
  ) {
    suffixLen++;
  }

  let forgedMiddleChars = 0;
  const grid: CharDiffSegment[] = [];

  for (let i = 0; i < len; i++) {
    const cChar = cand[i];
    const tChar = trust[i];
    const isPrefix = i < prefixLen;
    const isSuffix = i >= len - suffixLen;
    const matches = cChar.toLowerCase() === tChar.toLowerCase();

    let zone: 'PREFIX' | 'MIDDLE' | 'SUFFIX' = 'MIDDLE';
    let status: 'MATCH_PREFIX_SUFFIX' | 'FORGED_MIDDLE' | 'NEUTRAL' = 'NEUTRAL';

    if (isPrefix) {
      zone = 'PREFIX';
      status = 'MATCH_PREFIX_SUFFIX';
    } else if (isSuffix) {
      zone = 'SUFFIX';
      status = 'MATCH_PREFIX_SUFFIX';
    } else {
      zone = 'MIDDLE';
      forgedMiddleChars += 1;
      status = 'FORGED_MIDDLE';
    }

    grid.push({
      index: i,
      candidateChar: cChar,
      trustedChar: tChar,
      zone,
      matches,
      status,
    });
  }

  return {
    grid,
    matchingPrefixChars: prefixLen,
    matchingSuffixChars: suffixLen,
    forgedMiddleChars,
  };
}

export function evaluateOutboundPoisonRisk(params: {
  candidateInput: string;
  expectedMode?: VaultSettlementMode;
  trustedContacts?: TrustedContactRecord[];
}): OutboundPoisonScanResult {
  const startPerf = performance.now();
  const raw = params.candidateInput.trim();
  const expectedMode = params.expectedMode ?? 'EVM_SOCKET';
  const contacts = params.trustedContacts ?? SEEDED_TRUSTED_CONTACTS;

  // Check if user pasted a known demo shorthand alias
  const aliasResolved = DEMO_ADDRESS_ALIASES[raw.toLowerCase()];
  const inputToValidate = aliasResolved ?? raw;

  // Step 1: Validate multi-protocol format & EIP-55 / Bech32m / Base58 checksum (Case 4C)
  const validation = validateMultiProtocolAddress(inputToValidate, expectedMode);
  if (!validation.valid || !validation.normalizedAddress) {
    return {
      verdict: 'INVALID_ADDRESS_OR_NETWORK_MISMATCH',
      candidateAddress: raw,
      normalizedCandidateAddress: validation.normalizedAddress,
      validationError: validation.errorMessage,
      detectedProtocol: validation.detectedProtocol,
      checksumFixSuggestion: validation.checksumFixSuggestion,
      matchedTrustedContact: null,
      matchingPrefixChars: 0,
      matchingSuffixChars: 0,
      forgedMiddleChars: 0,
      similarityScore: 0,
      priorLegitimateInteractions: 0,
      dustOutDegree: 0,
      dustSampleTransfers: [],
      charDiffGrid: [],
      executionTimeMs: Number((performance.now() - startPerf).toFixed(2)),
      summaryNarrative:
        validation.errorMessage ??
        'Address failed cryptographic format or network validation.',
    };
  }

  const normalizedCandidate = validation.normalizedAddress;
  const candLower = normalizedCandidate.toLowerCase();

  // Step 2: Query Seeded TigerGraph Dataset for Dust Out-Degree
  const dataset = buildSeededGraphDataset();
  const dustOutDegree = dataset.poisonDustDegreeByAddress.get(candLower) ?? 0;

  const dustSampleTransfers = dataset.edges
    .filter(
      (e) => e.e_type === 'DUSTED' && e.from_id.toLowerCase() === candLower
    )
    .map((e) => ({
      toAddress: e.to_id,
      amountUsd: e.attributes.amount_usd,
      token: e.attributes.token,
      txHash: e.attributes.tx_hash,
      timestamp: e.attributes.timestamp,
    }));

  // Step 3: Check if candidate is an exact Trusted Contact
  const exactTrusted = contacts.find(
    (c) => c.address.toLowerCase() === candLower
  );
  if (exactTrusted) {
    const diff = buildCharacterDiffGrid(normalizedCandidate, exactTrusted.address);
    return {
      verdict: 'VERIFIED_TRUSTED_CONTACT',
      candidateAddress: raw,
      normalizedCandidateAddress: normalizedCandidate,
      detectedProtocol: validation.detectedProtocol,
      matchedTrustedContact: exactTrusted,
      matchingPrefixChars: 42,
      matchingSuffixChars: 42,
      forgedMiddleChars: 0,
      similarityScore: 1,
      priorLegitimateInteractions: exactTrusted.priorOutboundCount,
      dustOutDegree: 0,
      dustSampleTransfers: [],
      charDiffGrid: diff.grid,
      executionTimeMs: Number((performance.now() - startPerf).toFixed(2)),
      summaryNarrative: `Verified Trusted Contact "${exactTrusted.label}" — Paid ${exactTrusted.priorOutboundCount} times previously ($${exactTrusted.totalVolumeUsd.toLocaleString()} total volume) with 0 dust-factory activity.`,
    };
  }

  // Step 4: Compare candidate prefix & suffix against all Trusted Contacts (Sub-Case 4A)
  let bestContact: TrustedContactRecord | null = null;
  let bestDiff = {
    grid: [] as CharDiffSegment[],
    matchingPrefixChars: 0,
    matchingSuffixChars: 0,
    forgedMiddleChars: 0,
  };
  let highestMimicScore = -1;

  for (const contact of contacts) {
    const diff = buildCharacterDiffGrid(normalizedCandidate, contact.address);
    const hexPrefixMatched = Math.max(0, diff.matchingPrefixChars - 2);
    const hexSuffixMatched = diff.matchingSuffixChars;
    const score = hexPrefixMatched + hexSuffixMatched;
    if (score > highestMimicScore) {
      highestMimicScore = score;
      bestContact = contact;
      bestDiff = diff;
    }
  }

  const hexPrefixCount = Math.max(0, bestDiff.matchingPrefixChars - 2);
  const hexSuffixCount = bestDiff.matchingSuffixChars;
  const isLookalikeVanity = hexPrefixCount >= 3 && hexSuffixCount >= 3;
  const addrLen = Math.max(1, normalizedCandidate.length);
  const similarityScore = Number(
    ((bestDiff.matchingPrefixChars + bestDiff.matchingSuffixChars) / addrLen).toFixed(3)
  );

  // Sub-Case 4A: Poisoned Vanity Clone or High-Out-Degree Dust Factory
  if ((isLookalikeVanity && bestContact) || dustOutDegree >= 50) {
    const summaryNarrative = bestContact
      ? `POISONGRAPH INTERCEPT: Candidate ${normalizedCandidate.slice(0, 10)}...${normalizedCandidate.slice(-4)} mimics the first ${bestDiff.matchingPrefixChars} chars (${normalizedCandidate.slice(0, bestDiff.matchingPrefixChars)}) and last ${bestDiff.matchingSuffixChars} chars (${normalizedCandidate.slice(-bestDiff.matchingSuffixChars)}) of trusted contact "${bestContact.label}" (${bestContact.address.slice(0, 10)}...${bestContact.address.slice(-4)}), has ${bestDiff.forgedMiddleChars} forged middle hex characters, 0 prior legitimate outbound transfers, and ${dustOutDegree.toLocaleString()} outbound zero/micro-value dust transfers (<= $0.01).`
      : `POISONGRAPH INTERCEPT: Candidate ${normalizedCandidate.slice(0, 10)}...${normalizedCandidate.slice(-4)} has high automated dusting out-degree (${dustOutDegree.toLocaleString()} outbound zero/micro-value dust transfers <= $0.01) with 0 prior legitimate outbound transfers.`;

    return {
      verdict: 'INTERCEPTED_POISONING',
      candidateAddress: raw,
      normalizedCandidateAddress: normalizedCandidate,
      detectedProtocol: validation.detectedProtocol,
      matchedTrustedContact: bestContact,
      matchingPrefixChars: bestDiff.matchingPrefixChars,
      matchingSuffixChars: bestDiff.matchingSuffixChars,
      forgedMiddleChars: bestDiff.forgedMiddleChars,
      similarityScore,
      priorLegitimateInteractions: 0,
      dustOutDegree,
      dustSampleTransfers,
      charDiffGrid: bestDiff.grid,
      executionTimeMs: Number((performance.now() - startPerf).toFixed(2)),
      summaryNarrative,
    };
  }

  // Sub-Case 4B: First-Time Recipient (no mimicry match against provided contacts)
  if (contacts.length === 0) {
    return {
      verdict: 'VERIFIED_FIRST_TIME_RECIPIENT',
      candidateAddress: raw,
      normalizedCandidateAddress: normalizedCandidate,
      detectedProtocol: validation.detectedProtocol,
      matchedTrustedContact: null,
      matchingPrefixChars: 0,
      matchingSuffixChars: 0,
      forgedMiddleChars: 0,
      similarityScore: 0,
      priorLegitimateInteractions: 0,
      dustOutDegree,
      dustSampleTransfers: [],
      charDiffGrid: [],
      executionTimeMs: Number((performance.now() - startPerf).toFixed(2)),
      summaryNarrative:
        'First-Time Recipient — No Prior History. No trusted contacts provided to compare against. Always verify the recipient address out-of-band.',
    };
  }

  return {
    verdict: 'VERIFIED_FIRST_TIME_RECIPIENT',
    candidateAddress: raw,
    normalizedCandidateAddress: normalizedCandidate,
    detectedProtocol: validation.detectedProtocol,
    matchedTrustedContact: bestContact,
    matchingPrefixChars: bestDiff.matchingPrefixChars,
    matchingSuffixChars: bestDiff.matchingSuffixChars,
    forgedMiddleChars: bestDiff.forgedMiddleChars,
    similarityScore,
    priorLegitimateInteractions: 0,
    dustOutDegree,
    dustSampleTransfers: [],
    charDiffGrid: bestDiff.grid,
    executionTimeMs: Number((performance.now() - startPerf).toFixed(2)),
    summaryNarrative: `First-Time Recipient — Checked against ${contacts.length} saved contact(s). No lookalike prefix/suffix mimicry detected. Always verify the recipient address out-of-band.`,
  };
}
