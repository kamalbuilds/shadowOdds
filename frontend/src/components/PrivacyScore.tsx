"use client";

import { useAccount, useReadContract } from "wagmi";
import { useUnlinkBalance } from "@unlink-xyz/react";
import { SHADOW_ODDS_ADDRESS, USDC_ADDRESS } from "@/lib/wagmi";
import ShadowOddsABI from "@/lib/ShadowOddsABI.json";

interface PrivacyScoreProps {
  marketId?: number;
}

/**
 * Privacy Score — shows a visual "shield level" based on user's privacy posture.
 * Level 0: Connected only
 * Level 1: Bet placed (direction hidden via commit-reveal)
 * Level 2: Winnings claimed
 * Level 3: Winnings shielded via Unlink ZK pool (max privacy)
 */
export function PrivacyScore({ marketId }: PrivacyScoreProps) {
  const { address } = useAccount();
  const { balance: privateBalance } = useUnlinkBalance(USDC_ADDRESS);

  // Check if user has bet on this market
  const { data: betData } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "bets",
    args: address && marketId !== undefined ? [BigInt(marketId), address] : undefined,
    query: { enabled: !!address && marketId !== undefined },
  });

  const bet = betData as [string, bigint, number, boolean, boolean] | undefined;
  const hasBet = bet && bet[1] > 0n;
  const hasRevealed = bet?.[3] ?? false;
  const hasClaimed = bet?.[4] ?? false;
  const hasShielded = privateBalance !== undefined && privateBalance > 0n;

  // Calculate privacy level
  let level = 0;
  const steps = [
    { label: "Wallet Connected", done: !!address, desc: "Public identity on-chain" },
    { label: "Hidden Bet Placed", done: !!hasBet, desc: "Direction hidden via commit-reveal" },
    { label: "Winnings Claimed", done: hasClaimed, desc: "USDC received to public wallet" },
    { label: "Shielded via Unlink", done: hasShielded, desc: "Zero-knowledge privacy — link broken" },
  ];

  for (const step of steps) {
    if (step.done) level++;
  }

  // Colors by level
  const levelColors = [
    { ring: "border-red-500/40", bg: "bg-red-500/10", text: "text-red-400", glow: "#ef444440", label: "EXPOSED" },
    { ring: "border-yellow-500/40", bg: "bg-yellow-500/10", text: "text-yellow-400", glow: "#eab30840", label: "PARTIAL" },
    { ring: "border-blue-500/40", bg: "bg-blue-500/10", text: "text-blue-400", glow: "#3b82f640", label: "GOOD" },
    { ring: "border-[#7C3AED]/40", bg: "bg-[#7C3AED]/10", text: "text-[#7C3AED]", glow: "#7C3AED40", label: "STRONG" },
    { ring: "border-[#00FF94]/40", bg: "bg-[#00FF94]/10", text: "text-[#00FF94]", glow: "#00FF9440", label: "MAXIMUM" },
  ];

  const color = levelColors[level];
  const percentage = (level / 4) * 100;

  if (!address) {
    return (
      <div className="rounded-xl border border-gray-800 bg-[#111] p-5">
        <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
          <ShieldIcon className="w-4 h-4 text-gray-500" />
          Privacy Score
        </h3>
        <p className="text-gray-500 text-xs">Connect wallet to see your privacy score.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${color.ring} ${color.bg} p-5 transition-all duration-500`}
         style={{ boxShadow: `0 0 20px ${color.glow}` }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold text-sm flex items-center gap-2">
          <ShieldIcon className={`w-4 h-4 ${color.text}`} />
          Privacy Score
        </h3>
        <span className={`text-xs font-bold font-mono ${color.text} px-2 py-0.5 rounded-full border ${color.ring}`}>
          {color.label}
        </span>
      </div>

      {/* Score ring */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="#1f1f1f" strokeWidth="4" />
            <circle
              cx="32" cy="32" r="28" fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 1.76} 176`}
              className={`${color.text} transition-all duration-1000`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-lg font-black font-mono ${color.text}`}>{level}/4</span>
          </div>
        </div>
        <div className="flex-1 text-xs space-y-1">
          {level === 4 ? (
            <p className="text-[#00FF94] font-bold">Maximum privacy achieved!</p>
          ) : level === 0 ? (
            <p className="text-red-400">Your activity is fully visible on-chain.</p>
          ) : (
            <p className="text-gray-400">
              {4 - level} step{4 - level > 1 ? "s" : ""} remaining for maximum privacy.
            </p>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
              step.done
                ? "border-[#00FF94] bg-[#00FF9420]"
                : "border-gray-700 bg-transparent"
            }`}>
              {step.done && (
                <svg className="w-3 h-3 text-[#00FF94]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${step.done ? "text-white" : "text-gray-500"}`}>
                {step.label}
              </p>
              <p className="text-[10px] text-gray-600 truncate">{step.desc}</p>
            </div>
            {step.done && i === 3 && (
              <span className="text-[10px] font-mono text-[#00FF94] bg-[#00FF9415] px-1.5 py-0.5 rounded border border-[#00FF9430]">
                ZK
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Bottom CTA */}
      {level > 0 && level < 4 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <p className="text-[10px] text-gray-600 font-mono">
            {level === 1 && "Next: Wait for market resolution, then reveal your bet."}
            {level === 2 && "Next: Claim your winnings when eligible."}
            {level === 3 && "Next: Shield USDC in the Unlink panel below to break the link."}
          </p>
        </div>
      )}
    </div>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}
