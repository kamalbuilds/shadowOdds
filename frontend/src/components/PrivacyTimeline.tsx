"use client";

import { useState } from "react";
import { useUnlinkHistory, useUnlinkBalances, useTxStatus, type HistoryEntry } from "@unlink-xyz/react";
import { formatUnits } from "viem";

// Privacy level for each transaction kind
const PRIVACY_MAP: Record<string, { level: string; color: string; icon: string; arrow: string }> = {
  Deposit:  { level: "Partial",  color: "#F59E0B", icon: "D", arrow: "PUBLIC → PRIVATE" },
  Receive:  { level: "Maximum",  color: "#00FF94", icon: "R", arrow: "PRIVATE ← PRIVATE" },
  Send:     { level: "Maximum",  color: "#00FF94", icon: "S", arrow: "PRIVATE → PRIVATE" },
  SelfSend: { level: "Maximum",  color: "#7C3AED", icon: "↻", arrow: "SELF TRANSFER" },
  Withdraw: { level: "Partial",  color: "#F59E0B", icon: "W", arrow: "PRIVATE → PUBLIC" },
};

function StatusDot({ status }: { status: string }) {
  if (status === "confirmed") return <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94]" />;
  if (status === "pending") return <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-red-400" />;
}

function TxStatusTracker({ txId }: { txId: string }) {
  const { state, txHash, isLoading } = useTxStatus(txId);
  if (isLoading) return <span className="text-[10px] text-gray-600 font-mono animate-pulse">tracking...</span>;
  if (!state) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[10px] font-mono font-bold ${
        state === "succeeded" ? "text-[#00FF94]" : state === "pending" ? "text-yellow-400" : "text-red-400"
      }`}>
        {state}
      </span>
      {txHash && (
        <span className="text-[9px] text-gray-700 font-mono">{txHash.slice(0, 8)}...</span>
      )}
    </div>
  );
}

function TimelineEntry({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const privacy = PRIVACY_MAP[entry.kind] ?? PRIVACY_MAP.Deposit;
  const amount = entry.amounts?.[0];
  const formattedAmount = amount ? formatUnits(BigInt(Math.abs(Number(amount.delta ?? 0))), 6) : "?";
  const timeStr = entry.timestamp
    ? new Date(entry.timestamp * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div
      className="group flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-[#ffffff04] cursor-pointer transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      {/* Icon */}
      <div className="relative">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-black border shrink-0"
          style={{
            backgroundColor: `${privacy.color}10`,
            borderColor: `${privacy.color}30`,
            color: privacy.color,
          }}
        >
          {privacy.icon}
        </div>
        {/* Connector line */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 w-px h-3 bg-gray-800 group-last:hidden" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-white font-semibold">{entry.kind}</span>
            <StatusDot status={entry.status} />
          </div>
          <span className="text-[10px] text-gray-700 font-mono">{timeStr}</span>
        </div>

        {/* Privacy arrow */}
        <div className="flex items-center gap-2 mt-1">
          <span
            className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${privacy.color}15`, color: privacy.color }}
          >
            {privacy.arrow}
          </span>
          <span className="text-[11px] text-gray-400 font-mono">{formattedAmount} USDC</span>
        </div>

        {/* Privacy level badge */}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[9px] text-gray-600 uppercase tracking-widest font-mono">Privacy:</span>
          <span
            className="text-[10px] font-mono font-bold"
            style={{ color: privacy.color }}
          >
            {privacy.level === "Maximum" ? "MAXIMUM — all fields hidden" : "PARTIAL — amount visible"}
          </span>
        </div>

        {/* Expanded: tx tracking */}
        {expanded && entry.txHash && (
          <div className="mt-2 pt-2 border-t border-gray-800/50 space-y-1">
            <TxStatusTracker txId={entry.id} />
            <a
              href={`https://testnet.monadexplorer.com/tx/${entry.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#00FF94] hover:underline font-mono"
            >
              View on Explorer →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function PrivacyTimeline() {
  const { history, loading, error, refresh } = useUnlinkHistory();
  const { balances, ready: balancesReady } = useUnlinkBalances();

  // Format known token addresses to readable names
  const tokenNames: Record<string, string> = {
    "0x9967affd3be3110af967d62d8f61598c8224ef3f": "USDC",
    "0xe557929407b3eacb89cff69f46d3dfcb81724615": "USDC",
  };

  return (
    <div className="rounded-2xl border border-[#7C3AED30] bg-[#7C3AED08] overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#7C3AED]" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 3v3.69l2.28 2.28a.75.75 0 01-1.06 1.06l-2.5-2.5A.75.75 0 017.25 8V4a.75.75 0 011.5 0z" />
          </svg>
          <span className="text-[11px] text-gray-400 font-mono uppercase tracking-widest">Privacy Timeline</span>
        </div>
        <button
          onClick={refresh}
          className="text-[10px] text-gray-600 hover:text-[#7C3AED] font-mono transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Multi-token shielded balances */}
      {balancesReady && Object.keys(balances).length > 0 && (
        <div className="mx-4 mb-2 rounded-lg bg-[#0A0A0A] p-2">
          <p className="text-[9px] text-gray-600 font-mono mb-1 uppercase tracking-wider">Shielded Balances</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(balances).map(([token, bal]) => (
              <span key={token} className="text-[10px] font-mono text-[#7C3AED] bg-[#7C3AED10] px-2 py-0.5 rounded border border-[#7C3AED20]">
                {formatUnits(bal, 6)} {tokenNames[token.toLowerCase()] ?? token.slice(0, 6)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Privacy legend */}
      <div className="flex items-center gap-3 px-4 pb-2">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#00FF94]" />
          <span className="text-[9px] text-gray-600 font-mono">Max privacy</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
          <span className="text-[9px] text-gray-600 font-mono">Partial</span>
        </div>
      </div>

      {loading && (
        <div className="px-4 pb-4">
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg shimmer" />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 pb-4">
          <p className="text-xs text-red-400 font-mono">Failed to load history</p>
        </div>
      )}

      {!loading && !error && history.length === 0 && (
        <div className="px-4 pb-4 text-center py-6">
          <p className="text-gray-600 text-xs font-mono">No privacy transactions yet.</p>
          <p className="text-gray-700 text-[10px] mt-1">Shield USDC to start building your privacy timeline.</p>
        </div>
      )}

      {!loading && !error && history.length > 0 && (
        <div className="max-h-[400px] overflow-y-auto px-1 pb-2">
          {history.map((entry) => (
            <TimelineEntry key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {/* Stats */}
      {history.length > 0 && (
        <div className="border-t border-[#7C3AED20] px-4 py-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[9px] text-gray-600 font-mono uppercase">Deposits</p>
            <p className="text-sm font-bold text-[#F59E0B] font-mono">
              {history.filter(h => h.kind === "Deposit").length}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-gray-600 font-mono uppercase">Transfers</p>
            <p className="text-sm font-bold text-[#00FF94] font-mono">
              {history.filter(h => h.kind === "Send" || h.kind === "Receive").length}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-gray-600 font-mono uppercase">Withdrawals</p>
            <p className="text-sm font-bold text-[#F59E0B] font-mono">
              {history.filter(h => h.kind === "Withdraw").length}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
