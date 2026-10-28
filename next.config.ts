import type { NextConfig } from 'next';
import path from 'path';

const shimPath = './src/lib/utils/optional-peer-shim.ts';
const absShimPath = path.resolve(__dirname, 'src/lib/utils/optional-peer-shim.ts');

const optionalPeers = [
  '@x402/evm',
  '@x402/core/client',
  '@x402/evm/exact/client',
  '@x402/evm/upto/client',
  '@x402/svm/exact/client',
  '@react-native-async-storage/async-storage',
];

const turbopackAliases: Record<string, string> = {};
for (const pkg of optionalPeers) {
  turbopackAliases[pkg] = shimPath;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pino-pretty', 'lokijs', 'encoding'],
  turbopack: {
    root: __dirname,
    resolveAlias: turbopackAliases,
  },
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    for (const pkg of optionalPeers) {
      config.resolve.alias[pkg] = absShimPath;
    }
    return config;
  },
};

export default nextConfig;
