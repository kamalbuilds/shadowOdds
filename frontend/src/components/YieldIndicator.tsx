"use client";

import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
import { SHADOW_ODDS_V2_ADDRESS, YIELD_VAULT_ADDRESS } from "@/lib/wagmi";
import { formatUSDC, calculateEstimatedYield } from "@/lib/shadowodds";
import ShadowOddsV2ABI from "@/lib/ShadowOddsABI.json";
import YieldVaultABI from "@/lib/YieldVaultABI.json";

interface YieldIndicatorProps {
  marketId: number;
  totalPool: bigint;
}

export function YieldIndicator({ marketId, totalPool }: YieldIndicatorProps) {
  const [tick, setTick] = useState(0);

  // Read yield info from V2 contract
  const { data: yieldInfo } = useReadContract({
    address: SHADOW_ODDS_V2_ADDRESS,
    abi: ShadowOddsV2ABI,
    functionName: "getYieldInfo",
    args: [BigInt(marketId)],
    query: { refetchInterval: 10000 },
  });

  // Tick every second for live yield interpolation
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const info = yieldInfo as [bigint, bigint, bigint, bigint, boolean] | undefined;
  const deposited = info?.[0] ?? 0n;
  const depositTime = info?.[2] ? Number(info[2]) : 0;
  const harvested = info?.[4] ?? false;

  // Client-side yield estimate (ticks up in real-time)
  const { yieldUsdc, durationSeconds } = depositTime > 0
    ? calculateEstimatedYield(deposited, depositTime)
    : { yieldUsdc: 0n, durationSeconds: 0 };

  // If V2 not configured or no deposits, don't render
  if (!SHADOW_ODDS_V2_ADDRESS || deposited === 0n) return null;

  const durationDays = Math.floor(durationSeconds / 86400);
  const durationHours = Math.floor((durationSeconds % 86400) / 3600);

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">Yield Vault</h3>
        <span className="text-xs font-medium text-[#00e87b] bg-[#00e87b]/10 px-2 py-0.5 rounded-md">
          5% APR
        </span>
      </div>

      <p className="text-xs text-zinc-500 mb-4">
        Locked USDC earns simulated yield while bets are active.
      </p>

      <div className="space-y-2.5">
        <div className="flex justify-between text-sm">
          <span className="text-zinc-500">Pool earning</span>
          <span className="text-white font-mono">{formatUSDC(deposited)}</span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-zinc-500">Accrued yield</span>
          <span className="text-[#00e87b] font-mono font-medium">
            {harvested ? "Harvested" : `+${formatUSDC(yieldUsdc)}`}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-zinc-500">Duration</span>
          <span className="text-zinc-400 font-mono text-xs">
            {durationDays > 0 ? `${durationDays}d ` : ""}{durationHours}h
          </span>
        </div>
      </div>

      {/* Yield progress bar */}
      {!harvested && yieldUsdc > 0n && (
        <div className="mt-4 pt-3 border-t border-zinc-800/40">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#00e87b] rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(100, (Number(yieldUsdc) / Math.max(1, Number(deposited))) * 100 * 20)}%` }}
              />
            </div>
            <span className="text-[11px] text-zinc-600 font-mono">5%/yr</span>
          </div>
        </div>
      )}

      {harvested && (
        <div className="mt-3 pt-3 border-t border-zinc-800/40">
          <p className="text-xs text-zinc-500">
            Yield has been harvested and distributed to winners proportionally.
          </p>
        </div>
      )}
    </div>
  );
}
