"use client";

import Link from "next/link";
import { useReadContract } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { MarketCard } from "@/components/MarketCard";
import { PrivacyFlow } from "@/components/PrivacyFlow";
import { LiveActivityFeed } from "@/components/LiveActivityFeed";
import { Outcome } from "@/lib/shadowodds";
import { SHADOW_ODDS_ADDRESS } from "@/lib/wagmi";
import ShadowOddsABI from "@/lib/ShadowOddsABI.json";

function MarketFetcher({ id }: { id: number }) {
  const { data, isLoading, isError } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "markets",
    args: [BigInt(id)],
    query: { refetchInterval: 6000 },
  });

  if (isLoading) {
    return <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5 shimmer h-48" />;
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5 flex items-center justify-center h-48">
        <p className="text-zinc-600 text-sm">Failed to load market #{id}</p>
      </div>
    );
  }

  const marketData = data as [
    string, bigint, bigint, bigint, number, string, string, bigint, number, boolean, bigint, bigint, bigint,
  ];

  return (
    <MarketCard
      id={id}
      question={marketData[0]}
      totalPool={marketData[10]}
      bettingDeadline={marketData[1]}
      resolved={marketData[9]}
      result={marketData[8] as Outcome}
    />
  );
}

function MarketsList() {
  const { data: marketCount, isLoading: countLoading } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "marketCount",
    query: { refetchInterval: 6000 },
  });

  if (!SHADOW_ODDS_ADDRESS) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <p className="text-lg mb-2">Contract not configured</p>
        <p className="text-sm">Set NEXT_PUBLIC_SHADOW_ODDS_ADDRESS in your .env</p>
      </div>
    );
  }

  if (countLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-5 shimmer h-48" />
        ))}
      </div>
    );
  }

  const count = Number(marketCount ?? 0);

  if (count === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-zinc-400 text-lg mb-2">No markets yet</p>
        <p className="text-zinc-600 text-sm">Markets will appear here once created.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: count }, (_, i) => i + 1).map((id) => (
        <MarketFetcher key={id} id={id} />
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#09090b]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800/50 bg-[#09090b]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-[#00e87b] flex items-center justify-center">
              <span className="text-black text-xs font-bold">S</span>
            </div>
            <span className="text-white font-semibold text-[15px]">ShadowOdds</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/speed"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-zinc-300 hover:text-white border border-zinc-800 hover:border-zinc-700 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#00e87b] pulse-live" />
              Speed
            </Link>
            <Link
              href="/dashboard"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-zinc-300 hover:text-white border border-zinc-800 hover:border-zinc-700 transition-colors"
            >
              My Bets
            </Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-5 pt-20 pb-14">
        <div className="max-w-2xl">
          <p className="text-[#00e87b] text-sm font-medium mb-3 fade-in">
            Private prediction market on Monad
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] mb-4 tracking-tight fade-in fade-in-d1">
            Your bets stay hidden.
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed mb-4 fade-in fade-in-d2">
            On Polymarket, everyone sees your positions. Front-runners exploit you.
            ShadowOdds hides your direction with commit-reveal cryptography and
            shields your winnings through Unlink ZK privacy pools.
          </p>
          <p className="text-zinc-600 text-sm fade-in fade-in-d3">
            Bet amount is visible for settlement. Direction (YES/NO) is hidden on-chain.
          </p>
        </div>
      </section>

      {/* Privacy Flow */}
      <PrivacyFlow />

      {/* Markets + Live Feed */}
      <section className="max-w-6xl mx-auto px-5 pb-20">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="text-white text-xl font-semibold">Markets</h2>
          <Link
            href="/speed"
            className="sm:hidden text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Speed Markets →
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <MarketsList />
          <div className="hidden lg:block">
            <div className="sticky top-20">
              <LiveActivityFeed />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50">
        <div className="max-w-6xl mx-auto px-5 py-6 flex items-center justify-between">
          <p className="text-zinc-700 text-xs">
            Monad &middot; Pyth Oracle &middot; Unlink ZK &middot; USDC
          </p>
          <p className="text-zinc-800 text-xs">
            Unlink x Monad Hackathon 2026
          </p>
        </div>
      </footer>
    </div>
  );
}
