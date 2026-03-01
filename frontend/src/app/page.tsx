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
    return <div className="rounded-2xl border border-gray-800/50 bg-[#0C0E14] p-5 shimmer h-52" />;
  }

  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-gray-800/50 bg-[#0C0E14] p-5 flex items-center justify-center h-52">
        <p className="text-gray-600 text-sm">Failed to load market #{id}</p>
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
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg mb-2">Contract not configured</p>
        <p className="text-sm">Set NEXT_PUBLIC_SHADOW_ODDS_ADDRESS in your .env</p>
      </div>
    );
  }

  if (countLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-gray-800/50 bg-[#0C0E14] p-5 shimmer h-52" />
        ))}
      </div>
    );
  }

  const count = Number(marketCount ?? 0);

  if (count === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#0C0E14] border border-gray-800/50 flex items-center justify-center">
          <svg className="w-7 h-7 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <p className="text-gray-400 text-lg mb-2">No markets yet</p>
        <p className="text-gray-600 text-sm">Markets will appear here once created.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {Array.from({ length: count }, (_, i) => i + 1).map((id) => (
        <MarketFetcher key={id} id={id} />
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#06070B]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[#151820] bg-[#06070B]/85 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#00FF94] to-[#7C3AED] flex items-center justify-center shadow-[0_0_12px_#00FF9420]">
              <span className="text-black text-[10px] font-black">S</span>
            </div>
            <span className="text-white font-bold text-base tracking-tight">ShadowOdds</span>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono text-[#00FF94] bg-[#00FF9410] border border-[#00FF9420]">
              MONAD
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <Link href="/speed" className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold text-[#00FF94] border border-[#00FF9420] bg-[#00FF940A] hover:bg-[#00FF9415] transition-colors">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] status-live" />
              SPEED
            </Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-12 overflow-hidden">
        {/* Subtle ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#00FF94] opacity-[0.02] blur-[100px] rounded-full pointer-events-none" />
        <div className="absolute top-10 right-10 w-[400px] h-[400px] bg-[#7C3AED] opacity-[0.025] blur-[100px] rounded-full pointer-events-none" />

        <div className="relative text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#151820] bg-[#0C0E14] text-[11px] text-gray-400 mb-6 fade-in-up">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] pulse-green" />
            First private prediction market on EVM
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.05] mb-5 tracking-tight fade-in-up fade-in-up-delay-1">
            <span className="text-white">Your bets are</span>{" "}
            <span className="gradient-text">hidden.</span>
          </h1>

          <p className="text-gray-400 text-base sm:text-lg leading-relaxed mb-3 max-w-2xl mx-auto fade-in-up fade-in-up-delay-2">
            On Polymarket, anyone sees your positions. Front-runners exploit you.
            Market makers track your wallet. Those days are over.
          </p>

          <p className="text-gray-600 text-sm leading-relaxed max-w-xl mx-auto fade-in-up fade-in-up-delay-3">
            Commit-reveal cryptography + Unlink ZK privacy pools. Trustless Pyth oracle resolution on Monad.
          </p>

          {/* Tech badges */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-6 fade-in-up fade-in-up-delay-3">
            {[
              { label: "Monad", desc: "10k TPS", color: "#836EF9" },
              { label: "Pyth", desc: "400ms", color: "#7C3AED" },
              { label: "Unlink", desc: "ZK pool", color: "#00FF94" },
              { label: "USDC", desc: "settle", color: "#2775CA" },
            ].map((tech) => (
              <span
                key={tech.label}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border bg-[#0C0E14]"
                style={{ borderColor: `${tech.color}20`, color: tech.color }}
              >
                <span className="w-1 h-1 rounded-full" style={{ backgroundColor: tech.color }} />
                {tech.label}
                <span className="text-gray-600">{tech.desc}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* HONEST DISCLOSURE */}
      <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        <div className="rounded-2xl border border-[#7C3AED30] bg-[#7C3AED08] p-5 max-w-2xl mx-auto">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-8 h-8 rounded-lg bg-[#7C3AED15] border border-[#7C3AED30] flex items-center justify-center text-sm">
              <svg className="w-4 h-4 text-[#7C3AED]" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h2 className="text-white font-bold text-sm mb-2 flex items-center gap-2">
                HONEST DISCLOSURE
                <span className="text-[10px] font-normal text-[#7C3AED] font-mono">[important]</span>
              </h2>
              <div className="space-y-1.5 text-[13px] text-gray-300 leading-relaxed">
                <p>
                  <span className="text-white font-semibold">Bet AMOUNT is visible</span>
                  <span className="text-gray-500"> — required for on-chain settlement.</span>
                </p>
                <p>
                  <span className="text-[#00FF94] font-semibold">DIRECTION (YES/NO) is hidden</span>
                  <span className="text-gray-500"> — keccak256 commit-reveal until you choose to reveal.</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Privacy Flow */}
      <PrivacyFlow />

      {/* Markets + Live Feed — Two Column Layout */}
      <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-white text-xl font-bold tracking-tight">Active Markets</h2>
            <p className="text-gray-600 text-[13px] mt-0.5">Multi-asset prediction markets with hidden positions</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-600 font-mono">
              <span className="bg-gray-800 text-gray-700 px-1.5 py-0.5 rounded text-[10px]">████</span>
              <span>= hidden</span>
            </div>
            <Link
              href="/speed"
              className="sm:hidden flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold text-[#00FF94] border border-[#00FF9420] bg-[#00FF940A]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] status-live" />
              SPEED
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          {/* Markets */}
          <MarketsList />
          {/* Activity Feed sidebar */}
          <div className="hidden lg:block">
            <div className="sticky top-20">
              <LiveActivityFeed />
            </div>
          </div>
        </div>
      </section>

      {/* Stats Footer */}
      <footer className="border-t border-[#151820]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Network", value: "Monad", sub: "10,000 TPS" },
              { label: "Block Time", value: "400ms", sub: "Near-instant" },
              { label: "Oracle", value: "Pyth", sub: "Trustless feeds" },
              { label: "Privacy", value: "Unlink", sub: "ZK shielded" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-[#151820] bg-[#0C0E14] p-3.5 text-center">
                <p className="text-gray-700 text-[10px] mb-0.5 uppercase tracking-widest font-mono">{stat.label}</p>
                <p className="text-[#00FF94] font-bold text-base font-mono">{stat.value}</p>
                <p className="text-gray-700 text-[10px] mt-0.5">{stat.sub}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 text-center text-gray-800 text-[10px] font-mono tracking-wide">
            Unlink x Monad Hackathon &middot; Commit-reveal &middot; Pyth oracle &middot; ZK shielding &middot; USDC
          </div>
        </div>
      </footer>
    </div>
  );
}
