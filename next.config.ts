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
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        {
          key: 'Content-Security-Policy',
          value:
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' https://api.socket.tech https://public-backend.socket.tech https://dedicated-backend.socket.tech https://*.etherscan.io https://api.gopluslabs.io https://*.reown.com wss://*.reown.com wss://*.walletconnect.org https://*.walletconnect.com https://*.upstash.io http://localhost:* http://127.0.0.1:*; frame-ancestors 'none';",
        },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
      ],
    },
  ],
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
