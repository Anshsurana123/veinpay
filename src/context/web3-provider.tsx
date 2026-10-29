'use client';

import React, { type ReactNode, useState } from 'react';
import { createAppKit } from '@reown/appkit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi';
import {
  projectId,
  networks,
  wagmiAdapter,
  appKitMetadata,
} from '@/config/wagmi';

// Initialize Reown AppKit modal with Institutional Warm Carbon & Burnished Copper theme if projectId is provided
if (projectId) {
  createAppKit({
    adapters: [wagmiAdapter],
    networks,
    projectId,
    metadata: appKitMetadata,
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent': '#D97736',
      '--w3m-color-mix': '#131519',
      '--w3m-color-mix-strength': 25,
      '--w3m-font-family': 'var(--font-sans), sans-serif',
      '--w3m-border-radius-master': '1px',
    },
    features: {
      analytics: false,
      email: false,
      socials: false,
    },
  });
}

export function Web3Provider({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      })
  );

  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies
  );

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
