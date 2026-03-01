"use client";

import Link from "next/link";
import { Outcome, formatUSDC, timeRemaining } from "@/lib/shadowodds";

interface MarketCardProps {
  id: number;
  question: string;
  totalPool: bigint;
  bettingDeadline: bigint;
  resolved: boolean;
  result: Outcome;
}

/** Detect asset from question text */
function detectAsset(question: string): { symbol: string; color: string; emoji: string } {
  const q = question.toLowerCase();
  if (q.includes("eth")) return { symbol: "ETH", color: "#627EEA", emoji: "E" };
  if (q.includes("btc") || q.includes("bitcoin")) return { symbol: "BTC", color: "#F7931A", emoji: "B" };
  if (q.includes("sol") || q.includes("solana")) return { symbol: "SOL", color: "#9945FF", emoji: "S" };
  if (q.includes("doge")) return { symbol: "DOGE", color: "#C2A633", emoji: "D" };
  if (q.includes("mon") && !q.includes("month")) return { symbol: "MON", color: "#836EF9", emoji: "M" };
  if (q.includes("link")) return { symbol: "LINK", color: "#2A5ADA", emoji: "L" };
  return { symbol: "EVT", color: "#00FF94", emoji: "?" };
}

function getTimeStatus(deadline: bigint): "open" | "closing" | "closed" {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) return "closed";
  const secsLeft = Number(deadline - now);
  if (secsLeft < 3600) return "closing";
  return "open";
}

export function MarketCard({ id, question, totalPool, bettingDeadline, resolved, result }: MarketCardProps) {
  const timeStatus = getTimeStatus(bettingDeadline);
  const remaining = timeRemaining(bettingDeadline);
  const truncated = question.length > 80 ? question.slice(0, 77) + "..." : question;
  const asset = detectAsset(question);

  return (
    <Link href={`/market/${id}`}>
      <div className="card-hover rounded-xl border border-gray-800 bg-[#111111] p-5 cursor-pointer h-full flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Asset icon */}
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black text-white shrink-0"
              style={{ backgroundColor: `${asset.color}20`, border: `1px solid ${asset.color}40` }}
            >
              <span style={{ color: asset.color }}>{asset.emoji}</span>
            </div>
            <span className="text-xs font-mono text-gray-500">#{id}</span>
          </div>
          {resolved ? (
            <OutcomeBadge result={result} />
          ) : (
            <StatusBadge status={timeStatus} />
          )}
        </div>

        {/* Question */}
        <p className="text-white font-medium leading-snug flex-1 text-sm">{truncated}</p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-800/60">
          <div>
            <p className="text-[10px] text-gray-500 mb-0.5 uppercase tracking-wider font-mono">Pool</p>
            <p className="font-mono text-sm text-[#00FF94] font-semibold">
              {formatUSDC(totalPool)}
            </p>
          </div>

          {!resolved && (
            <div className="text-right">
              <p className="text-[10px] text-gray-500 mb-0.5 uppercase tracking-wider font-mono">Closes</p>
              <p className={`font-mono text-sm font-semibold ${
                timeStatus === "open" ? "text-[#00FF94]" :
                timeStatus === "closing" ? "text-yellow-400" :
                "text-gray-500"
              }`}>
                {remaining}
              </p>
            </div>
          )}

          {resolved && (
            <div className="text-right">
              <p className="text-[10px] text-gray-500 mb-0.5 uppercase tracking-wider font-mono">Result</p>
              <p className={`text-sm font-bold ${result === Outcome.YES ? "text-green-400" : result === Outcome.NO ? "text-red-400" : "text-gray-400"}`}>
                {result === Outcome.YES ? "YES" : result === Outcome.NO ? "NO" : "Pending"}
              </p>
            </div>
          )}
        </div>

        {/* Hidden positions indicator */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-gray-600">
          <svg className="w-3 h-3 text-[#00FF94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>Positions: <span className="redacted px-1 text-[10px]">████</span> hidden</span>
        </div>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: "open" | "closing" | "closed" }) {
  if (status === "open") {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#00FF941A] border border-[#00FF9430] text-[#00FF94] text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] status-live" />
        OPEN
      </span>
    );
  }
  if (status === "closing") {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-900/20 border border-yellow-700/30 text-yellow-400 text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 status-live" />
        CLOSING SOON
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-gray-400 text-xs font-semibold">
      CLOSED
    </span>
  );
}

function OutcomeBadge({ result }: { result: Outcome }) {
  if (result === Outcome.YES) {
    return (
      <span className="px-2.5 py-1 rounded-full bg-green-900/30 border border-green-700/40 text-green-400 text-xs font-bold">
        YES WON
      </span>
    );
  }
  if (result === Outcome.NO) {
    return (
      <span className="px-2.5 py-1 rounded-full bg-red-900/30 border border-red-700/40 text-red-400 text-xs font-bold">
        NO WON
      </span>
    );
  }
  return (
    <span className="px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-gray-400 text-xs font-bold">
      PENDING
    </span>
  );
}
