/**
 * VeinPay — TigerGraph RESTPP Endpoint Client & Query Adapter
 * File: src/lib/tigergraph.ts
 *
 * Implements the TigerGraph 4.x/3.x RESTPP query client for:
 *   /restpp/query/{graph_name}/veinpay_firewall_check?target_wallet=...&max_hops=...
 * Parses standard TigerGraph JSON response envelope: { version, error, message, results }
 */

import type {
  FirewallPolicyConfig,
  FirewallScanResult,
  TigerGraphRestppEnvelope,
  VerdictStatus,
} from '@/types/veinpay';
import {
  tryExecuteLiveTigerGraphQuery,
  upsertGraphToTigerGraph,
  buildTigerGraphFailClosedScan,
} from '@/lib/graph/tigergraph-client';

export interface TigerGraphQueryParams {
  host?: string;
  graphName?: string;
  token?: string;
  targetWallet: string;
  merchantWallet?: string;
  maxHops?: number;
  sybilThreshold?: number;
  cleanLinkEnabled?: boolean;
  unbundleEnabled?: boolean;
  firewallEnabled?: boolean;
}

/**
 * Direct TigerGraph RESTPP Endpoint Caller
 * Queries /restpp/query/{graph_name}/veinpay_firewall_check
 * with query parameters or POST body, and parses standard TigerGraph envelope.
 */
export async function queryTigerGraphRestpp(
  params: TigerGraphQueryParams
): Promise<TigerGraphRestppEnvelope> {
  const host =
    params.host?.trim() || process.env.TIGERGRAPH_HOST?.trim() || '';
  const graphName =
    params.graphName?.trim() ||
    process.env.TIGERGRAPH_GRAPH?.trim() ||
    'VeinPayGraph';
  const token =
    params.token?.trim() || process.env.TIGERGRAPH_TOKEN?.trim() || '';

  if (!host) {
    return {
      version: { edition: 'enterprise', api: 'v2', schema: 0 },
      error: true,
      message: 'TigerGraph host is not configured (TIGERGRAPH_HOST missing).',
      results: [],
    };
  }

  const baseUrl = host.startsWith('http') ? host.replace(/\/+$/, '') : `https://${host}`;
  const queryParams = new URLSearchParams({
    target_wallet: params.targetWallet,
    merchant_wallet: params.merchantWallet || '',
    max_hops: String(params.maxHops ?? 3),
    sybil_threshold: String(params.sybilThreshold ?? 10),
    clean_link_enabled: String(params.cleanLinkEnabled ?? true),
    unbundle_enabled: String(params.unbundleEnabled ?? true),
    firewall_enabled: String(params.firewallEnabled ?? true),
  });

  const url = `${baseUrl}/restpp/query/${encodeURIComponent(graphName)}/veinpay_firewall_check?${queryParams.toString()}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(3500),
    });

    if (!res.ok) {
      return {
        version: { edition: 'enterprise', api: 'v2', schema: 0 },
        error: true,
        message: `TigerGraph RESTPP query failed with HTTP status ${res.status}: ${res.statusText}`,
        results: [],
      };
    }

    const envelope = (await res.json()) as TigerGraphRestppEnvelope;
    return envelope;
  } catch (err) {
    return {
      version: { edition: 'enterprise', api: 'v2', schema: 0 },
      error: true,
      message: `TigerGraph query error: ${err instanceof Error ? err.message : 'timeout or network error'}`,
      results: [],
    };
  }
}

// Re-export full client methods and utilities for seamless imports across src/
export {
  tryExecuteLiveTigerGraphQuery,
  upsertGraphToTigerGraph,
  buildTigerGraphFailClosedScan,
};
