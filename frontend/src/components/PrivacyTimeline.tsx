"use client";

import { useState } from "react";
import { useUnlinkHistory, useUnlinkBalances, useTxStatus, type HistoryEntry } from "@unlink-xyz/react";
import { formatUnits } from "viem";

const PRIVACY_MAP: Record<string, { level: string; color: string; label: string }> = {
  Deposit:  { level: "Partial",  color: "text-amber-400", label: "public to private" },
  Receive:  { level: "Maximum",  color: "text-[#00e87b]", label: "private from private" },
  Send:     { level: "Maximum",  color: "text-[#00e87b]", label: "private to private" },
  SelfSend: { level: "Maximum",  color: "text-[#836EF9]", label: "self transfer" },
  Withdraw: { level: "Partial",  color: "text-amber-400", label: "private to public" },
};

function StatusDot({ status }: { status: string }) {
  if (status === "confirmed") return <span className="w-1.5 h-1.5 rounded-full bg-[#00e87b]" />;
  if (status === "pending") return <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-red-400" />;
}

function TxStatusTracker({ txId }: { txId: string }) {
  const { state, txHash, isLoading } = useTxStatus(txId);
  if (isLoading) return <span className="text-[11px] text-zinc-600 font-mono animate-pulse">tracking...</span>;
  if (!state) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[11px] font-mono font-medium ${
        state === "succeeded" ? "text-[#00e87b]" : state === "pending" ? "text-amber-400" : "text-red-400"
      }`}>
        {state}
      </span>
      {txHash && (
        <span className="text-[11px] text-zinc-700 font-mono">{txHash.slice(0, 8)}...</span>
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
      className="flex items-start gap-3 px-3 py-3 rounded-md hover:bg-zinc-800/30 cursor-pointer transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="relative">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold border shrink-0 ${privacy.color} border-zinc-700/60 bg-zinc-800/40`}>
          {entry.kind.charAt(0)}
        </div>
        <div className="absolute top-7 left-1/2 -translate-x-1/2 w-px h-3 bg-zinc-800 group-last:hidden" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white font-medium">{entry.kind}</span>
            <StatusDot status={entry.status} />
          </div>
          <span className="text-[11px] text-zinc-700 font-mono">{timeStr}</span>
        </div>

        <div className="flex items-center gap-2 mt-1">
          <span className={`text-[11px] font-mono ${privacy.color}`}>{privacy.label}</span>
          <span className="text-[11px] text-zinc-500 font-mono">{formattedAmount} USDC</span>
        </div>

        <div className="flex items-center gap-2 mt-1">
          <span className={`text-[11px] font-mono ${privacy.color}`}>
            {privacy.level === "Maximum" ? "All fields hidden" : "Amount visible"}
          </span>
        </div>

        {expanded && entry.txHash && (
          <div className="mt-2 pt-2 border-t border-zinc-800/50 space-y-1">
            <TxStatusTracker txId={entry.id} />
            <a
              href={`https://testnet.monadexplorer.com/tx/${entry.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-[#00e87b] hover:underline font-mono"
            >
              View on Explorer
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

  const tokenNames: Record<string, string> = {
    "0x9967affd3be3110af967d62d8f61598c8224ef3f": "USDC",
    "0xe557929407b3eacb89cff69f46d3dfcb81724615": "USDC",
  };

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-xs text-zinc-400">Privacy Timeline</span>
        <button
          onClick={refresh}
          className="text-[11px] text-zinc-600 hover:text-[#836EF9] transition-colors"
        >
          Refresh
        </button>
      </div>

      {balancesReady && Object.keys(balances).length > 0 && (
        <div className="mx-4 mb-2 rounded-lg bg-zinc-950 p-2">
          <p className="text-[11px] text-zinc-600 mb-1">Shielded balances</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(balances).map(([token, bal]) => (
              <span key={token} className="text-[11px] font-mono text-[#836EF9] bg-[#836EF9]/10 px-2 py-0.5 rounded border border-[#836EF9]/20">
                {formatUnits(bal, 6)} {tokenNames[token.toLowerCase()] ?? token.slice(0, 6)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 px-4 pb-2">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00e87b]" />
          <span className="text-[11px] text-zinc-600">Max privacy</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-[11px] text-zinc-600">Partial</span>
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
          <p className="text-xs text-red-400">Failed to load history</p>
        </div>
      )}

      {!loading && !error && history.length === 0 && (
        <div className="px-4 pb-4 text-center py-6">
          <p className="text-zinc-600 text-xs">No privacy transactions yet.</p>
          <p className="text-zinc-700 text-[11px] mt-1">Shield USDC to start building your timeline.</p>
        </div>
      )}

      {!loading && !error && history.length > 0 && (
        <div className="max-h-[400px] overflow-y-auto px-1 pb-2">
          {history.map((entry) => (
            <TimelineEntry key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="border-t border-zinc-800/60 px-4 py-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[11px] text-zinc-600">Deposits</p>
            <p className="text-sm font-medium text-amber-400 font-mono">
              {history.filter(h => h.kind === "Deposit").length}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-600">Transfers</p>
            <p className="text-sm font-medium text-[#00e87b] font-mono">
              {history.filter(h => h.kind === "Send" || h.kind === "Receive").length}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-600">Withdrawals</p>
            <p className="text-sm font-medium text-amber-400 font-mono">
              {history.filter(h => h.kind === "Withdraw").length}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
