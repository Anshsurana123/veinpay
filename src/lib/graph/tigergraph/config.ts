export interface TigerGraphConfig {
  host: string;
  graph: string;
  token?: string;
  secret?: string;
  timeoutMs: number;
}

export function getTigerGraphConfig(): TigerGraphConfig | null {
  const host = process.env.TIGERGRAPH_HOST?.trim();
  if (!host) return null;

  return {
    host: host.startsWith('http') ? host.replace(/\/+$/, '') : `https://${host}`,
    graph: process.env.TIGERGRAPH_GRAPH?.trim() || 'VeinPayGraph',
    token: process.env.TIGERGRAPH_TOKEN?.trim(),
    secret: process.env.TIGERGRAPH_SECRET?.trim(),
    timeoutMs: Number(process.env.TIGERGRAPH_TIMEOUT_MS) || 4000,
  };
}
