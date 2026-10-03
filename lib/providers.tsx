'use client';
import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { walletConfig } from './wagmi';
export function Providers({children}:{children:ReactNode}) {
  const [queryClient]=useState(()=>new QueryClient());
  return <WagmiProvider config={walletConfig}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></WagmiProvider>;
}
