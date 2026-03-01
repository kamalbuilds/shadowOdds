"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UnlinkProvider } from "@unlink-xyz/react";
import { config } from "@/lib/wagmi";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <UnlinkProvider chain="monad-testnet" autoSync={true} syncInterval={5000}>
          {children}
        </UnlinkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
