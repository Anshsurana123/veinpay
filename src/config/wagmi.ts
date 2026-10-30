import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import {
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  optimismSepolia,
  polygonAmoy,
} from '@reown/appkit/networks';
import type { AppKitNetwork } from '@reown/appkit/networks';

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID?.trim() || '';

export const isReownConfigured = Boolean(projectId);

if (!isReownConfigured) {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    console.warn(
      '⚠️ [VeilPay CRITICAL WARNING]: NEXT_PUBLIC_PROJECT_ID is missing in production build! Wallet connect is disabled. Configure NEXT_PUBLIC_PROJECT_ID at dashboard.reown.com.'
    );
  }
}

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  // Mainnets
  arbitrum,
  base,
  mainnet,
  optimism,
  polygon,
  // Testnets
  arbitrumSepolia,
  baseSepolia,
  sepolia,
  optimismSepolia,
  polygonAmoy,
];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
});

export const appKitMetadata = {
  name: 'VeilPay — Pre-Sign Graph Firewall & Zero-Doxx Checkout',
  description:
    'Sub-50ms TigerGraph 3-in-1 Pre-Sign Firewall, AIGI Deterministic Forensics, SOCKET V3 Cross-Chain Routing & Cake Wallet Vault Settlement (Mainnet & Testnet).',
  url: process.env.NEXT_PUBLIC_APP_URL || 'https://veinpay.vercel.app',
  icons: [`${process.env.NEXT_PUBLIC_APP_URL || 'https://veinpay.vercel.app'}/icon.png`],
};
