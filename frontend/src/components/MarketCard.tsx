"use client";

import Link from "next/link";
import { Outcome, formatUSDC, timeRemaining } from "@/lib/shadowodds";
import { CryptoIcon } from "./CryptoIcon";

interface MarketCardProps {
  id: number;
  question: string;
  totalPool: bigint;
  bettingDeadline: bigint;
  resolved: boolean;
  result: Outcome;
}

function detectAsset(question: string): { symbol: string; color: string } {
  const q = question.toLowerCase();
  if (q.includes("eth")) return { symbol: "ETH", color: "#627EEA" };
  if (q.includes("btc") || q.includes("bitcoin")) return { symbol: "BTC", color: "#F7931A" };
  if (q.includes("sol") || q.includes("solana")) return { symbol: "SOL", color: "#9945FF" };
  if (q.includes("doge")) return { symbol: "DOGE", color: "#C2A633" };
  if (q.includes("mon") && !q.includes("month")) return { symbol: "MON", color: "#836EF9" };
  return { symbol: "EVT", color: "#00e87b" };
}

function getTimeStatus(deadline: bigint): "open" | "closing" | "closed" {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) return "closed";
  if (Number(deadline - now) < 3600) return "closing";
  return "open";
}

export function MarketCard({ id, question, totalPool, bettingDeadline, resolved, result }: MarketCardProps) {
  const timeStatus = getTimeStatus(bettingDeadline);
  const remaining = timeRemaining(bettingDeadline);
  const truncated = question.length > 80 ? question.slice(0, 77) + "..." : question;
  const asset = detectAsset(question);

  return (
    <Link href={`/market/${id}`}>
      <div className="card-hover rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5 cursor-pointer h-full flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CryptoIcon symbol={asset.symbol} size={28} />
            <span className="text-xs text-zinc-600">#{id}</span>
          </div>
          {resolved ? (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${
              result === Outcome.YES ? "text-green-400 bg-green-400/10" :
              result === Outcome.NO ? "text-red-400 bg-red-400/10" :
              "text-zinc-400 bg-zinc-800"
            }`}>
              {result === Outcome.YES ? "YES" : result === Outcome.NO ? "NO" : "Pending"}
            </span>
          ) : (
            <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md ${
              timeStatus === "open" ? "text-[#00e87b] bg-[#00e87b]/10" :
              timeStatus === "closing" ? "text-amber-400 bg-amber-400/10" :
              "text-zinc-500 bg-zinc-800"
            }`}>
              {timeStatus === "open" && <span className="w-1 h-1 rounded-full bg-[#00e87b] pulse-live" />}
              {timeStatus === "open" ? "Open" : timeStatus === "closing" ? "Closing" : "Closed"}
            </span>
          )}
        </div>

        {/* Question */}
        <p className="text-white text-[15px] font-medium leading-snug flex-1">{truncated}</p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-800/40">
          <div>
            <p className="text-[11px] text-zinc-600 mb-0.5">Pool</p>
            <p className="font-mono text-sm text-[#00e87b] font-medium">{formatUSDC(totalPool)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-zinc-600 mb-0.5">{resolved ? "Result" : "Closes"}</p>
            <p className={`font-mono text-sm font-medium ${
              resolved ? (result === Outcome.YES ? "text-green-400" : "text-red-400") :
              timeStatus === "open" ? "text-zinc-300" :
              timeStatus === "closing" ? "text-amber-400" :
              "text-zinc-500"
            }`}>
              {resolved
                ? (result === Outcome.YES ? "YES" : result === Outcome.NO ? "NO" : "—")
                : remaining}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}
