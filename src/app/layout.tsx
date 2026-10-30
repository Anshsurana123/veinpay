import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Web3Provider } from '@/context/web3-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'VeinPay — Pre-Sign Graph Firewall & Cross-Chain Payment Link',
  description:
    'Calm, zero-doxx cross-chain payments screened by TigerGraph, verified by AIGI, routed by Socket and CCTP, settled to Cake Wallet.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const cookies = headersList.get('cookie');

  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=DM+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen text-[#eaf0f3] antialiased">
        <Web3Provider cookies={cookies}>{children}</Web3Provider>
      </body>
    </html>
  );
}
