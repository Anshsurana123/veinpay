import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { Web3Provider } from '@/context/web3-provider';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'VeilPay // Zero-Doxx Cross-Chain Payment Link & Pre-Sign Graph Firewall',
  description:
    'Built for Hacker House Goa: Sub-50ms TigerGraph 3-in-1 Pre-Flight Graph Firewall (CleanLink, Unbundle, PoisonGraph), AIGI Deterministic Forensics, SOCKET V3 Cross-Chain Routing & Cake Wallet Vault Settlement.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const cookies = headersList.get('cookie');

  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <body className="min-h-screen bg-[#0B0C0E] text-[#F3F1EC] antialiased selection:bg-[#D97736] selection:text-[#0B0C0E]">
        <Web3Provider cookies={cookies}>{children}</Web3Provider>
      </body>
    </html>
  );
}
