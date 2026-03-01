"use client";

import { useState, useEffect, useRef } from "react";
import { usePublicClient } from "wagmi";
import { SHADOW_ODDS_ADDRESS, feedInfo } from "@/lib/wagmi";
import { formatUSDC } from "@/lib/shadowodds";
import ShadowOddsABI from "@/lib/ShadowOddsABI.json";
import { parseAbiItem } from "viem";

interface FeedItem {
  id: string;
  type: "bet" | "resolve" | "reveal" | "claim";
  wallet: string;
  amount?: bigint;
  marketId: number;
  timestamp: number;
  asset?: string;
}

const BET_PLACED_EVENT = parseAbiItem(
  "event BetPlaced(uint256 indexed marketId, address indexed bettor, bytes32 commitment, uint256 amount)"
);
const MARKET_RESOLVED_EVENT = parseAbiItem(
  "event MarketResolved(uint256 indexed marketId, uint8 result)"
);

function truncateAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function FeedEntry({ item }: { item: FeedItem }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const iconMap = {
    bet: (
      <div className="w-7 h-7 rounded-lg bg-[#00FF9415] border border-[#00FF9430] flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-[#00FF94]" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 3.5v3h3a.75.75 0 010 1.5h-3v3a.75.75 0 01-1.5 0v-3h-3a.75.75 0 010-1.5h3v-3a.75.75 0 011.5 0z" />
        </svg>
      </div>
    ),
    resolve: (
      <div className="w-7 h-7 rounded-lg bg-[#7C3AED15] border border-[#7C3AED30] flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-[#7C3AED]" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
        </svg>
      </div>
    ),
    reveal: (
      <div className="w-7 h-7 rounded-lg bg-purple-900/20 border border-purple-700/30 flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-purple-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2C4 2 1 8 1 8s3 6 7 6 7-6 7-6-3-6-7-6zm0 10a4 4 0 110-8 4 4 0 010 8zm0-6a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
      </div>
    ),
    claim: (
      <div className="w-7 h-7 rounded-lg bg-yellow-900/20 border border-yellow-700/30 flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-yellow-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a.75.75 0 01.75.75V5h2.75a.75.75 0 010 1.5H8.75v2.75a.75.75 0 01-1.5 0V6.5H4.5a.75.75 0 010-1.5h2.75V2.25A.75.75 0 018 1.5z" />
          <path d="M3.5 10a.75.75 0 01.75.75v1.5h8.5v-1.5a.75.75 0 011.5 0v2.25a.75.75 0 01-.75.75h-10a.75.75 0 01-.75-.75v-2.25A.75.75 0 013.5 10z" />
        </svg>
      </div>
    ),
  };

  const msgMap = {
    bet: (
      <span>
        <span className="text-gray-300 font-mono text-[11px]">{truncateAddr(item.wallet)}</span>
        <span className="text-gray-500"> bet </span>
        <span className="text-white font-bold">{item.amount ? formatUSDC(item.amount) : "?"}</span>
        <span className="text-gray-500"> on </span>
        <span className="text-gray-300">#{item.marketId}</span>
        <span className="text-gray-700"> — dir: </span>
        <span className="bg-gray-800 text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-mono">████</span>
      </span>
    ),
    resolve: (
      <span>
        <span className="text-gray-500">Market </span>
        <span className="text-gray-300">#{item.marketId}</span>
        <span className="text-gray-500"> resolved via </span>
        <span className="text-[#7C3AED]">Pyth Oracle</span>
      </span>
    ),
    reveal: (
      <span>
        <span className="text-gray-300 font-mono text-[11px]">{truncateAddr(item.wallet)}</span>
        <span className="text-gray-500"> revealed on </span>
        <span className="text-gray-300">#{item.marketId}</span>
      </span>
    ),
    claim: (
      <span>
        <span className="text-gray-300 font-mono text-[11px]">{truncateAddr(item.wallet)}</span>
        <span className="text-gray-500"> claimed winnings on </span>
        <span className="text-gray-300">#{item.marketId}</span>
      </span>
    ),
  };

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      } hover:bg-[#ffffff04]`}
    >
      {iconMap[item.type]}
      <div className="flex-1 min-w-0 text-[12px] leading-relaxed truncate">
        {msgMap[item.type]}
      </div>
      <span className="text-[10px] text-gray-700 font-mono shrink-0">{timeAgo(item.timestamp)}</span>
    </div>
  );
}

export function LiveActivityFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const publicClient = usePublicClient();

  // Fetch recent bet events from on-chain logs
  useEffect(() => {
    async function fetchLogs() {
      if (!publicClient || !SHADOW_ODDS_ADDRESS) return;
      try {
        const currentBlock = await publicClient.getBlockNumber();
        const fromBlock = currentBlock > 5000n ? currentBlock - 5000n : 0n;

        const betLogs = await publicClient.getLogs({
          address: SHADOW_ODDS_ADDRESS,
          event: BET_PLACED_EVENT,
          fromBlock,
          toBlock: "latest",
        });

        const resolvedLogs = await publicClient.getLogs({
          address: SHADOW_ODDS_ADDRESS,
          event: MARKET_RESOLVED_EVENT,
          fromBlock,
          toBlock: "latest",
        });

        const feedItems: FeedItem[] = [];

        for (const log of betLogs) {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          feedItems.push({
            id: `bet-${log.transactionHash}-${log.logIndex}`,
            type: "bet",
            wallet: (log.args as { bettor?: string })?.bettor ?? "0x???",
            amount: (log.args as { amount?: bigint })?.amount,
            marketId: Number((log.args as { marketId?: bigint })?.marketId ?? 0),
            timestamp: Number(block.timestamp),
          });
        }

        for (const log of resolvedLogs) {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          feedItems.push({
            id: `resolve-${log.transactionHash}-${log.logIndex}`,
            type: "resolve",
            wallet: "",
            marketId: Number((log.args as { marketId?: bigint })?.marketId ?? 0),
            timestamp: Number(block.timestamp),
          });
        }

        feedItems.sort((a, b) => b.timestamp - a.timestamp);
        setItems(feedItems.slice(0, 20));
      } catch {
        // Silently fail — feed is supplementary
      } finally {
        setLoading(false);
      }
    }

    fetchLogs();
    const interval = setInterval(fetchLogs, 15000);
    return () => clearInterval(interval);
  }, [publicClient]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-800/60 bg-[#0C0E14] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] status-live" />
          <span className="text-[11px] text-gray-500 font-mono uppercase tracking-widest">Live Feed</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-lg shimmer" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-800/60 bg-[#0C0E14] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
          <span className="text-[11px] text-gray-500 font-mono uppercase tracking-widest">Activity</span>
        </div>
        <p className="text-gray-700 text-xs text-center py-6 font-mono">No activity yet. Place the first bet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-800/60 bg-[#0C0E14] overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] status-live" />
          <span className="text-[11px] text-gray-500 font-mono uppercase tracking-widest">Live Feed</span>
        </div>
        <span className="text-[10px] text-gray-700 font-mono">{items.length} events</span>
      </div>
      <div ref={containerRef} className="max-h-[320px] overflow-y-auto px-1 pb-2 scrollbar-thin">
        {items.map((item) => (
          <FeedEntry key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
