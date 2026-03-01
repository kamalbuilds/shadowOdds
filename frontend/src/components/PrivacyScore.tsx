"use client";

import { useAccount, useReadContract } from "wagmi";
import { useUnlinkBalance } from "@unlink-xyz/react";
import { SHADOW_ODDS_ADDRESS, USDC_ADDRESS } from "@/lib/wagmi";
import ShadowOddsABI from "@/lib/ShadowOddsABI.json";

interface PrivacyScoreProps {
  marketId?: number;
}

export function PrivacyScore({ marketId }: PrivacyScoreProps) {
  const { address } = useAccount();
  const { balance: privateBalance } = useUnlinkBalance(USDC_ADDRESS);

  const { data: betData } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "bets",
    args: address && marketId !== undefined ? [BigInt(marketId), address] : undefined,
    query: { enabled: !!address && marketId !== undefined },
  });

  const bet = betData as [string, bigint, number, boolean, boolean] | undefined;
  const hasBet = bet && bet[1] > 0n;
  const hasClaimed = bet?.[4] ?? false;
  const hasShielded = privateBalance !== undefined && privateBalance > 0n;

  let level = 0;
  const steps = [
    { label: "Wallet connected", done: !!address, desc: "Public identity" },
    { label: "Hidden bet placed", done: !!hasBet, desc: "Direction hidden" },
    { label: "Winnings claimed", done: hasClaimed, desc: "USDC received" },
    { label: "Shielded via Unlink", done: hasShielded, desc: "Link broken" },
  ];

  for (const step of steps) {
    if (step.done) level++;
  }

  const levelInfo = [
    { color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/20", label: "Exposed" },
    { color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20", label: "Partial" },
    { color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20", label: "Good" },
    { color: "text-[#836EF9]", bg: "bg-[#836EF9]/10", border: "border-[#836EF9]/20", label: "Strong" },
    { color: "text-[#00e87b]", bg: "bg-[#00e87b]/10", border: "border-[#00e87b]/20", label: "Maximum" },
  ];

  const info = levelInfo[level];
  const pct = (level / 4) * 100;

  if (!address) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5">
        <h3 className="text-white font-semibold text-sm mb-2">Privacy Score</h3>
        <p className="text-zinc-500 text-sm">Connect wallet to see your score.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${info.border} ${info.bg} p-5`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-sm">Privacy Score</h3>
        <span className={`text-xs font-medium ${info.color}`}>{info.label}</span>
      </div>

      {/* Ring */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative w-14 h-14 shrink-0">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="#27272a" strokeWidth="4" />
            <circle
              cx="32" cy="32" r="28" fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${pct * 1.76} 176`}
              className={`${info.color} transition-all duration-700`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-sm font-bold font-mono ${info.color}`}>{level}/4</span>
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          {level === 4 ? "Maximum privacy achieved." :
           level === 0 ? "Fully visible on-chain." :
           `${4 - level} step${4 - level > 1 ? "s" : ""} to max privacy.`}
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className={`w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${
              step.done ? "border-[#00e87b] bg-[#00e87b]/15" : "border-zinc-700"
            }`}>
              {step.done && (
                <svg className="w-2.5 h-2.5 text-[#00e87b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <p className={`text-xs ${step.done ? "text-zinc-200" : "text-zinc-500"}`}>{step.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
