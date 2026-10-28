import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import {
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
} from '@reown/appkit/networks';
import type { AppKitNetwork } from '@reown/appkit/networks';

export const projectId =
  process.env.NEXT_PUBLIC_PROJECT_ID || 'b56e18d47c72ab683b10814fe9495694';

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
  arbitrum,
  base,
  mainnet,
  optimism,
  polygon,
];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
});

export const appKitMetadata = {
  name: 'VeilPay — Pre-Sign Graph Firewall & Zero-Doxx Checkout',
  description:
    'Sub-50ms TigerGraph 3-in-1 Pre-Sign Firewall, AIGI Deterministic Forensics, SOCKET V3 Cross-Chain Routing & Cake Wallet Vault Settlement.',
  url: 'https://veilpay.xyz',
  icons: ['https://veilpay.xyz/icon.png'],
};
