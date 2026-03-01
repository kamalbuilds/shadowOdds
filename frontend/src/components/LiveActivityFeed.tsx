"use client";

import { useState, useEffect, useRef } from "react";
import { usePublicClient } from "wagmi";
import { SHADOW_ODDS_ADDRESS } from "@/lib/wagmi";
import { formatUSDC } from "@/lib/shadowodds";
import { parseAbiItem } from "viem";

interface FeedItem {
  id: string;
  type: "bet" | "resolve";
  wallet: string;
  amount?: bigint;
  marketId: number;
  timestamp: number;
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
  if (diff < 10) return "now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function FeedEntry({ item }: { item: FeedItem }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-800/30 transition-colors">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.type === "bet" ? "bg-[#00e87b]" : "bg-[#836EF9]"}`} />
      <div className="flex-1 min-w-0 text-[13px] truncate">
        {item.type === "bet" ? (
          <span className="text-zinc-400">
            <span className="text-zinc-300 font-mono text-xs">{truncateAddr(item.wallet)}</span>
            {" bet "}
            <span className="text-white font-medium">{item.amount ? formatUSDC(item.amount) : "?"}</span>
            {" on #"}{item.marketId}
            <span className="text-zinc-700 ml-1">dir: <span className="redacted px-1 text-[11px]">████</span></span>
          </span>
        ) : (
          <span className="text-zinc-400">
            Market <span className="text-zinc-300">#{item.marketId}</span>
            {" resolved via "}
            <span className="text-[#836EF9]">Pyth</span>
          </span>
        )}
      </div>
      <span className="text-[11px] text-zinc-700 font-mono shrink-0">{timeAgo(item.timestamp)}</span>
    </div>
  );
}

export function LiveActivityFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const publicClient = usePublicClient();

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
        // Feed is supplementary
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
      <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00e87b] pulse-live" />
          <span className="text-xs text-zinc-500">Activity</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 rounded-md shimmer" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
          <span className="text-xs text-zinc-500">Activity</span>
        </div>
        <p className="text-zinc-700 text-sm text-center py-4">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00e87b] pulse-live" />
          <span className="text-xs text-zinc-500">Live Activity</span>
        </div>
        <span className="text-[11px] text-zinc-700">{items.length}</span>
      </div>
      <div ref={containerRef} className="max-h-[300px] overflow-y-auto px-1 pb-2">
        {items.map((item) => (
          <FeedEntry key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
