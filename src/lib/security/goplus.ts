/**
 * GoPlus Security API Client for VeilPay
 * Docs: https://docs.gopluslabs.io/reference/api-overview
 *
 * Implements:
 * 1. Address Security (AML, Drainers, Exploits, Sanctions, Mixers)
 * 2. Token Security (Honeypots, Buy/Sell Taxes, Mintable/Proxy Risks)
 * 3. Approval Security (Spender / Router authorization verification)
 * 4. Phishing Site Detection (Payment link & domain protection)
 * 5. Supported Chains Directory
 */

import type { RiskCategory } from '@/types/veilpay';

export interface GoPlusAddressSecurityRawResult {
  cybercrime?: string;
  money_laundering?: string;
  number_of_malicious_contracts_created?: string;
  gas_abuse?: string;
  financial_crime?: string;
  darkweb_transactions?: string;
  reinit?: string;
  phishing_activities?: string;
  contract_address?: string;
  fake_kyc?: string;
  blacklist_doubt?: string;
  fake_standard_interface?: string;
  data_source?: string;
  stealing_attack?: string;
  blackmail_activities?: string;
  sanctioned?: string;
  malicious_mining_activities?: string;
  mixer?: string;
  fake_token?: string;
  honeypot_related_address?: string;
  [key: string]: string | undefined;
}

export interface GoPlusAddressSecurityVerdict {
  isThreat: boolean;
  riskCategory: RiskCategory;
  label: string;
  source: string;
  details: {
    sanctioned: boolean;
    mixer: boolean;
    moneyLaundering: boolean;
    drainerOrPhishing: boolean;
    exploitOrCybercrime: boolean;
    honeypotCreator: boolean;
    gasAbuse: boolean;
    fakeTokenOrKyc: boolean;
  };
  raw?: GoPlusAddressSecurityRawResult;
  failed?: boolean;
  failureReason?: string;
}

export interface GoPlusTokenSecurityResult {
  isHoneypot: boolean;
  buyTaxPercent: number;
  sellTaxPercent: number;
  isOpenSource: boolean;
  isProxy: boolean;
  trustList: boolean;
  cannotBuy: boolean;
  tokenName?: string;
  tokenSymbol?: string;
  holderCount?: number;
  isSafeToTrade: boolean;
  riskReasons: string[];
  raw?: Record<string, unknown>;
}

export interface GoPlusApprovalSecurityResult {
  isContract: boolean;
  contractName?: string;
  tag?: string;
  trustList: boolean;
  doubtList: boolean;
  isProxy: boolean;
  isOpenSource: boolean;
  maliciousBehavior: string[];
  isSafeSpender: boolean;
  raw?: Record<string, unknown>;
}

export interface GoPlusPhishingResult {
  isPhishing: boolean;
  websiteContractSecurity: unknown[];
}

const addressCache = new Map<string, { timestamp: number; verdict: GoPlusAddressSecurityVerdict }>();
const tokenCache = new Map<string, { timestamp: number; result: GoPlusTokenSecurityResult }>();
const approvalCache = new Map<string, { timestamp: number; result: GoPlusApprovalSecurityResult }>();
const phishingCache = new Map<string, { timestamp: number; result: GoPlusPhishingResult }>();

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

export function getGoPlusHeaders(): Record<string, string> {
  const apiKey = process.env.GOPLUS_API_KEY?.trim();
  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  if (apiKey) {
    headers['X-API-KEY'] = apiKey;
    headers['api-key'] = apiKey;
  }
  return headers;
}

/**
 * Check EVM address security across GoPlus threat intelligence feeds.
 */
export async function checkGoPlusAddress(
  address: string,
  chainId: number | string = 1,
  timeoutMs = 3000
): Promise<GoPlusAddressSecurityVerdict> {
  const normAddr = address.trim().toLowerCase();
  const cacheKey = `${chainId}:${normAddr}`;
  const hit = addressCache.get(cacheKey);
  if (hit && Date.now() - hit.timestamp < CACHE_TTL_MS) {
    return hit.verdict;
  }

  const url = `https://api.gopluslabs.io/api/v1/address_security/${normAddr}?chain_id=${chainId}`;

  try {
    const res = await fetch(url, {
      headers: getGoPlusHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return {
        isThreat: false,
        riskCategory: 'CLEAN',
        label: '',
        source: '',
        details: {
          sanctioned: false,
          mixer: false,
          moneyLaundering: false,
          drainerOrPhishing: false,
          exploitOrCybercrime: false,
          honeypotCreator: false,
          gasAbuse: false,
          fakeTokenOrKyc: false,
        },
        failed: true,
        failureReason: `GoPlus HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      code?: number;
      message?: string;
      result?: GoPlusAddressSecurityRawResult;
    };

    if (!data.result) {
      if (data.code !== undefined && data.code !== 1) {
        return {
          isThreat: false,
          riskCategory: 'CLEAN',
          label: '',
          source: '',
          details: {
            sanctioned: false,
            mixer: false,
            moneyLaundering: false,
            drainerOrPhishing: false,
            exploitOrCybercrime: false,
            honeypotCreator: false,
            gasAbuse: false,
            fakeTokenOrKyc: false,
          },
          failed: true,
          failureReason: data.message || `GoPlus code ${data.code}`,
        };
      }
      const cleanVerdict: GoPlusAddressSecurityVerdict = {
        isThreat: false,
        riskCategory: 'CLEAN',
        label: '',
        source: '',
        details: {
          sanctioned: false,
          mixer: false,
          moneyLaundering: false,
          drainerOrPhishing: false,
          exploitOrCybercrime: false,
          honeypotCreator: false,
          gasAbuse: false,
          fakeTokenOrKyc: false,
        },
      };
      addressCache.set(cacheKey, { timestamp: Date.now(), verdict: cleanVerdict });
      return cleanVerdict;
    }

    const r = data.result;
    const isSanctioned = r.sanctioned === '1';
    const isMixer = r.mixer === '1';
    const isMoneyLaundering = r.money_laundering === '1';

    const isDrainer =
      r.stealing_attack === '1' ||
      r.phishing_activities === '1' ||
      r.blacklist_doubt === '1' ||
      r.fake_token === '1' ||
      r.fake_standard_interface === '1' ||
      (r.number_of_malicious_contracts_created !== undefined &&
        Number(r.number_of_malicious_contracts_created) > 0);

    const isExploit =
      r.cybercrime === '1' ||
      r.financial_crime === '1' ||
      r.darkweb_transactions === '1' ||
      r.gas_abuse === '1' ||
      r.fake_kyc === '1' ||
      r.blackmail_activities === '1' ||
      r.malicious_mining_activities === '1' ||
      r.honeypot_related_address === '1' ||
      r.reinit === '1';

    const details = {
      sanctioned: isSanctioned,
      mixer: isMixer,
      moneyLaundering: isMoneyLaundering,
      drainerOrPhishing: isDrainer,
      exploitOrCybercrime: isExploit,
      honeypotCreator: r.honeypot_related_address === '1',
      gasAbuse: r.gas_abuse === '1',
      fakeTokenOrKyc: r.fake_token === '1' || r.fake_kyc === '1',
    };

    let verdict: GoPlusAddressSecurityVerdict;

    if (isSanctioned || isMixer || isMoneyLaundering) {
      verdict = {
        isThreat: true,
        riskCategory: 'SANCTIONED_MIXER',
        label: `GoPlus Sanctioned/Mixer (${address.slice(0, 6)}...${address.slice(-4)})`,
        source: `GoPlus Security (${r.data_source || 'On-Chain Feed'})`,
        details,
        raw: r,
      };
    } else if (isDrainer) {
      verdict = {
        isThreat: true,
        riskCategory: 'APPROVAL_DRAINER',
        label: `GoPlus Drainer/Phishing (${address.slice(0, 6)}...${address.slice(-4)})`,
        source: `GoPlus Security (${r.data_source || 'ScamSniffer/SlowMist'})`,
        details,
        raw: r,
      };
    } else if (isExploit) {
      verdict = {
        isThreat: true,
        riskCategory: 'EXPLOIT_CONTRACT',
        label: `GoPlus Exploit/Crime (${address.slice(0, 6)}...${address.slice(-4)})`,
        source: `GoPlus Security (${r.data_source || 'BlockSec'})`,
        details,
        raw: r,
      };
    } else {
      verdict = {
        isThreat: false,
        riskCategory: 'CLEAN',
        label: '',
        source: '',
        details,
        raw: r,
      };
    }

    addressCache.set(cacheKey, { timestamp: Date.now(), verdict });
    return verdict;
  } catch (err) {
    return {
      isThreat: false,
      riskCategory: 'CLEAN',
      label: '',
      source: '',
      details: {
        sanctioned: false,
        mixer: false,
        moneyLaundering: false,
        drainerOrPhishing: false,
        exploitOrCybercrime: false,
        honeypotCreator: false,
        gasAbuse: false,
        fakeTokenOrKyc: false,
      },
      failed: true,
      failureReason: err instanceof Error ? err.message : 'GoPlus request failed',
    };
  }
}

/**
 * Check ERC-20 token security: honeypots, buy/sell tax gouging, proxy vulnerabilities.
 */
export async function checkGoPlusToken(
  tokenAddress: string,
  chainId: number | string = 1,
  timeoutMs = 3500
): Promise<GoPlusTokenSecurityResult> {
  const normAddr = tokenAddress.trim().toLowerCase();
  const cacheKey = `${chainId}:${normAddr}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && Date.now() - hit.timestamp < CACHE_TTL_MS) {
    return hit.result;
  }

  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${normAddr}`;

  try {
    const res = await fetch(url, {
      headers: getGoPlusHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return {
        isHoneypot: false,
        buyTaxPercent: 0,
        sellTaxPercent: 0,
        isOpenSource: true,
        isProxy: false,
        trustList: false,
        cannotBuy: false,
        isSafeToTrade: true,
        riskReasons: [],
      };
    }

    const data = (await res.json()) as {
      code?: number;
      result?: Record<string, Record<string, unknown>>;
    };

    const tokenData = data.result?.[normAddr];
    if (!tokenData) {
      return {
        isHoneypot: false,
        buyTaxPercent: 0,
        sellTaxPercent: 0,
        isOpenSource: true,
        isProxy: false,
        trustList: false,
        cannotBuy: false,
        isSafeToTrade: true,
        riskReasons: [],
      };
    }

    const isHoneypot = String(tokenData.is_honeypot) === '1';
    const cannotBuy = String(tokenData.cannot_buy) === '1';
    const buyTax = parseFloat(String(tokenData.buy_tax || '0')) * 100;
    const sellTax = parseFloat(String(tokenData.sell_tax || '0')) * 100;
    const isOpenSource = String(tokenData.is_open_source) === '1';
    const isProxy = String(tokenData.is_proxy) === '1';
    const trustList = String(tokenData.trust_list) === '1';
    const holderCount = tokenData.holder_count ? Number(tokenData.holder_count) : undefined;

    const riskReasons: string[] = [];
    if (isHoneypot) riskReasons.push('Token identified as Honeypot (funds cannot be sold)');
    if (cannotBuy) riskReasons.push('Token purchases are blocked by contract code');
    if (buyTax > 10) riskReasons.push(`High buy tax: ${buyTax.toFixed(1)}%`);
    if (sellTax > 10) riskReasons.push(`High sell tax: ${sellTax.toFixed(1)}%`);
    if (!isOpenSource && !trustList) riskReasons.push('Unverified closed-source token contract');

    const isSafeToTrade = !isHoneypot && !cannotBuy && buyTax <= 10 && sellTax <= 10;

    const result: GoPlusTokenSecurityResult = {
      isHoneypot,
      buyTaxPercent: buyTax,
      sellTaxPercent: sellTax,
      isOpenSource,
      isProxy,
      trustList,
      cannotBuy,
      tokenName: typeof tokenData.token_name === 'string' ? tokenData.token_name : undefined,
      tokenSymbol: typeof tokenData.token_symbol === 'string' ? tokenData.token_symbol : undefined,
      holderCount,
      isSafeToTrade,
      riskReasons,
      raw: tokenData,
    };

    tokenCache.set(cacheKey, { timestamp: Date.now(), result });
    return result;
  } catch {
    return {
      isHoneypot: false,
      buyTaxPercent: 0,
      sellTaxPercent: 0,
      isOpenSource: true,
      isProxy: false,
      trustList: false,
      cannotBuy: false,
      isSafeToTrade: true,
      riskReasons: [],
    };
  }
}

/**
 * Check spender / router approval contract security before signing ERC-20 approvals.
 */
export async function checkGoPlusApproval(
  contractAddress: string,
  chainId: number | string = 1,
  timeoutMs = 3500
): Promise<GoPlusApprovalSecurityResult> {
  const normAddr = contractAddress.trim().toLowerCase();
  const cacheKey = `${chainId}:${normAddr}`;
  const hit = approvalCache.get(cacheKey);
  if (hit && Date.now() - hit.timestamp < CACHE_TTL_MS) {
    return hit.result;
  }

  const url = `https://api.gopluslabs.io/api/v1/approval_security/${chainId}?contract_addresses=${normAddr}`;

  try {
    const res = await fetch(url, {
      headers: getGoPlusHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return {
        isContract: true,
        trustList: false,
        doubtList: false,
        isProxy: false,
        isOpenSource: true,
        maliciousBehavior: [],
        isSafeSpender: true,
      };
    }

    const data = (await res.json()) as {
      code?: number;
      result?: Record<string, unknown>;
    };

    const r = data.result || {};
    const isContract = Number(r.is_contract) === 1;
    const trustList = Number(r.trust_list) === 1;
    const doubtList = Number(r.doubt_list) === 1;
    const isProxy = Number(r.is_proxy) === 1;
    const isOpenSource = Number(r.is_open_source) === 1;
    const maliciousBehavior = Array.isArray(r.malicious_behavior)
      ? (r.malicious_behavior as string[])
      : [];

    const isSafeSpender = !doubtList && maliciousBehavior.length === 0;

    const result: GoPlusApprovalSecurityResult = {
      isContract,
      contractName: typeof r.contract_name === 'string' ? r.contract_name : undefined,
      tag: typeof r.tag === 'string' ? r.tag : undefined,
      trustList,
      doubtList,
      isProxy,
      isOpenSource,
      maliciousBehavior,
      isSafeSpender,
      raw: r,
    };

    approvalCache.set(cacheKey, { timestamp: Date.now(), result });
    return result;
  } catch {
    return {
      isContract: true,
      trustList: false,
      doubtList: false,
      isProxy: false,
      isOpenSource: true,
      maliciousBehavior: [],
      isSafeSpender: true,
    };
  }
}

/**
 * Check whether a URL / payment link domain is flagged as phishing by GoPlus.
 */
export async function checkGoPlusPhishing(
  targetUrl: string,
  timeoutMs = 3000
): Promise<GoPlusPhishingResult> {
  const normUrl = targetUrl.trim();
  const hit = phishingCache.get(normUrl);
  if (hit && Date.now() - hit.timestamp < CACHE_TTL_MS) {
    return hit.result;
  }

  const url = `https://api.gopluslabs.io/api/v1/phishing_site?url=${encodeURIComponent(normUrl)}`;

  try {
    const res = await fetch(url, {
      headers: getGoPlusHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return { isPhishing: false, websiteContractSecurity: [] };
    }

    const data = (await res.json()) as {
      code?: number;
      result?: {
        phishing_site?: number;
        website_contract_security?: unknown[];
      };
    };

    const isPhishing = data.result?.phishing_site === 1;
    const result: GoPlusPhishingResult = {
      isPhishing,
      websiteContractSecurity: data.result?.website_contract_security || [],
    };

    phishingCache.set(normUrl, { timestamp: Date.now(), result });
    return result;
  } catch {
    return { isPhishing: false, websiteContractSecurity: [] };
  }
}
