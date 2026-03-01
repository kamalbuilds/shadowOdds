"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { parseAbi } from "viem";
import {
  Outcome,
  OracleType,
  Market,
  loadCommitment,
  formatUSDC,
  outcomeLabel,
  timeRemaining,
} from "@/lib/shadowodds";
import {
  SHADOW_ODDS_ADDRESS,
  USDC_ADDRESS,
  PYTH_ADDRESS,
  PYTH_HERMES_URL,
  feedInfo,
} from "@/lib/wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import ShadowOddsABI from "@/lib/ShadowOddsABI.json";

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

const PYTH_ABI = parseAbi([
  "function getUpdateFee(bytes[] calldata updateData) view returns (uint256)",
]);

interface UserBet {
  marketId: number;
  market: Market;
  commitment: string;
  lockedAmount: bigint;
  onChainOutcome: Outcome;
  revealed: boolean;
  claimed: boolean;
  hasSavedBet: boolean;
}

function BetRow({ bet }: { bet: UserBet }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [step, setStep] = useState<"idle" | "resolving" | "revealing" | "claiming" | "done">("idle");

  const savedBet = address ? loadCommitment(bet.marketId, address) : null;
  const asset = feedInfo(bet.market.priceFeedId);
  const isWinner = bet.revealed && bet.market.resolved && bet.onChainOutcome === bet.market.result;
  const isLoser = bet.revealed && bet.market.resolved && bet.onChainOutcome !== bet.market.result;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const bettingOpen = now < bet.market.bettingDeadline && !bet.market.resolved;
  const canResolve = now >= bet.market.bettingDeadline && !bet.market.resolved;
  const canReveal = bet.market.resolved && !bet.revealed && savedBet && now < bet.market.revealDeadline;
  const canClaim = bet.market.resolved && bet.revealed && !bet.claimed && isWinner;

  async function handleResolve() {
    try {
      setStep("resolving");
      const res = await fetch(`${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${bet.market.priceFeedId}&encoding=hex`);
      const data = await res.json();
      const vaaHex = `0x${data.binary.data[0]}` as `0x${string}`;
      const fee = await publicClient!.readContract({
        address: PYTH_ADDRESS,
        abi: PYTH_ABI,
        functionName: "getUpdateFee",
        args: [[vaaHex]],
      });
      await writeContractAsync({
        address: SHADOW_ODDS_ADDRESS,
        abi: ShadowOddsABI,
        functionName: "resolveWithPyth",
        args: [BigInt(bet.marketId), [vaaHex]],
        value: fee,
      });
      setStep("done");
    } catch {
      setStep("idle");
    }
  }

  async function handleReveal() {
    if (!savedBet) return;
    try {
      setStep("revealing");
      await writeContractAsync({
        address: SHADOW_ODDS_ADDRESS,
        abi: ShadowOddsABI,
        functionName: "revealBet",
        args: [BigInt(bet.marketId), savedBet.secret, savedBet.outcome, savedBet.amount, savedBet.nonce],
      });
      setStep("done");
    } catch {
      setStep("idle");
    }
  }

  async function handleClaim() {
    try {
      setStep("claiming");
      await writeContractAsync({
        address: SHADOW_ODDS_ADDRESS,
        abi: ShadowOddsABI,
        functionName: "claimWinnings",
        args: [BigInt(bet.marketId)],
      });
      setStep("done");
    } catch {
      setStep("idle");
    }
  }

  function statusBadge() {
    if (bet.claimed) return <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-500">Claimed</span>;
    if (isWinner) return <span className="text-xs px-2 py-0.5 rounded bg-[#00e87b]/10 text-[#00e87b]">Won</span>;
    if (isLoser) return <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400">Lost</span>;
    if (bet.revealed) return <span className="text-xs px-2 py-0.5 rounded bg-[#836EF9]/10 text-[#836EF9]">Revealed</span>;
    if (bet.market.resolved) return <span className="text-xs px-2 py-0.5 rounded bg-amber-400/10 text-amber-400">Reveal needed</span>;
    if (canResolve) return <span className="text-xs px-2 py-0.5 rounded bg-amber-400/10 text-amber-400">Pending resolution</span>;
    if (bettingOpen) return <span className="text-xs px-2 py-0.5 rounded bg-[#00e87b]/10 text-[#00e87b]">Live</span>;
    return <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-500">Unknown</span>;
  }

  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Link href={`/market/${bet.marketId}`} className="text-white font-medium hover:text-[#00e87b] transition-colors">
            {asset.symbol !== "???" ? `${asset.symbol}/USD` : bet.market.question.slice(0, 30)}
          </Link>
          <span className="text-zinc-600 text-xs">#{bet.marketId}</span>
        </div>
        {statusBadge()}
      </div>

      <div className="grid grid-cols-4 gap-3 text-sm mb-3">
        <div>
          <p className="text-zinc-600 text-[11px] mb-0.5">Amount</p>
          <p className="text-white font-mono">{formatUSDC(bet.lockedAmount)}</p>
        </div>
        <div>
          <p className="text-zinc-600 text-[11px] mb-0.5">Direction</p>
          {bet.revealed ? (
            <p className={bet.onChainOutcome === Outcome.YES ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
              {bet.onChainOutcome === Outcome.YES ? "UP" : "DOWN"}
            </p>
          ) : (
            <p className="text-zinc-500">Hidden</p>
          )}
        </div>
        <div>
          <p className="text-zinc-600 text-[11px] mb-0.5">Result</p>
          {bet.market.resolved ? (
            <p className={bet.market.result === Outcome.YES ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
              {bet.market.result === Outcome.YES ? "UP" : "DOWN"}
            </p>
          ) : (
            <p className="text-zinc-500">{bettingOpen ? timeRemaining(bet.market.bettingDeadline) : "Pending"}</p>
          )}
        </div>
        <div>
          <p className="text-zinc-600 text-[11px] mb-0.5">Pool</p>
          <p className="text-[#00e87b] font-mono">{formatUSDC(bet.market.totalPool)}</p>
        </div>
      </div>

      {/* Action buttons */}
      {step === "done" ? (
        <p className="text-[#00e87b] text-xs text-center">Done — refreshing...</p>
      ) : (
        <div className="flex gap-2">
          {canResolve && bet.market.oracleType === OracleType.PRICE_FEED && (
            <button
              onClick={handleResolve}
              disabled={step !== "idle"}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors"
            >
              {step === "resolving" ? "Resolving..." : "Resolve"}
            </button>
          )}
          {canReveal && (
            <button
              onClick={handleReveal}
              disabled={step !== "idle"}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-white bg-[#836EF9] hover:bg-[#7360e0] disabled:opacity-40 transition-colors"
            >
              {step === "revealing" ? "Revealing..." : "Reveal"}
            </button>
          )}
          {canClaim && (
            <button
              onClick={handleClaim}
              disabled={step !== "idle"}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors"
            >
              {step === "claiming" ? "Claiming..." : "Claim"}
            </button>
          )}
          <Link
            href={`/market/${bet.marketId}`}
            className="px-3 py-2 rounded-lg text-xs text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
          >
            View
          </Link>
        </div>
      )}
    </div>
  );
}

function UserBetsList() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [bets, setBets] = useState<UserBet[]>([]);
  const [loading, setLoading] = useState(true);

  const { data: marketCount } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "marketCount",
    query: { refetchInterval: 5000 },
  });

  const fetchBets = useCallback(async () => {
    if (!address || !publicClient || !marketCount) return;
    setLoading(true);
    const count = Number(marketCount);
    const userBets: UserBet[] = [];

    for (let i = 1; i <= count; i++) {
      try {
        const [marketData, betData] = await Promise.all([
          publicClient.readContract({
            address: SHADOW_ODDS_ADDRESS,
            abi: ShadowOddsABI,
            functionName: "markets",
            args: [BigInt(i)],
          }),
          publicClient.readContract({
            address: SHADOW_ODDS_ADDRESS,
            abi: ShadowOddsABI,
            functionName: "bets",
            args: [BigInt(i), address],
          }),
        ]);

        const bd = betData as [string, bigint, number, boolean, boolean];
        if (bd[1] === 0n) continue; // No bet on this market

        const md = marketData as [string, bigint, bigint, bigint, number, string, string, bigint, number, boolean, bigint, bigint, bigint];
        const market: Market = {
          id: i,
          question: md[0],
          bettingDeadline: md[1],
          resolutionTime: md[2],
          revealDeadline: md[3],
          oracleType: md[4] as OracleType,
          priceOracle: md[5],
          priceFeedId: md[6],
          priceThreshold: md[7],
          result: md[8] as Outcome,
          resolved: md[9],
          totalPool: md[10],
          yesPool: md[11],
          noPool: md[12],
        };

        userBets.push({
          marketId: i,
          market,
          commitment: bd[0],
          lockedAmount: bd[1],
          onChainOutcome: bd[2] as Outcome,
          revealed: bd[3],
          claimed: bd[4],
          hasSavedBet: !!loadCommitment(i, address),
        });
      } catch { /* skip */ }
    }

    setBets(userBets.reverse()); // newest first
    setLoading(false);
  }, [address, publicClient, marketCount]);

  useEffect(() => {
    fetchBets();
    const id = setInterval(fetchBets, 8000);
    return () => clearInterval(id);
  }, [fetchBets]);

  if (!address) {
    return (
      <div className="text-center py-16">
        <p className="text-zinc-400 mb-4">Connect your wallet to see your bets</p>
        <ConnectButton />
      </div>
    );
  }

  if (loading && bets.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-zinc-500 text-sm">
        <span className="w-4 h-4 border-2 border-zinc-600 border-t-[#00e87b] rounded-full spinner" />
        Loading your bets...
      </div>
    );
  }

  if (bets.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-zinc-400 mb-2">No bets placed yet</p>
        <div className="flex justify-center gap-3">
          <Link href="/" className="text-sm text-[#00e87b] hover:underline">Browse markets</Link>
          <Link href="/speed" className="text-sm text-[#836EF9] hover:underline">Speed markets</Link>
        </div>
      </div>
    );
  }

  const active = bets.filter((b) => !b.claimed && !b.market.resolved);
  const needsAction = bets.filter((b) => {
    if (b.claimed) return false;
    if (b.market.resolved && !b.revealed) return true;
    if (b.revealed && !b.claimed && b.onChainOutcome === b.market.result) return true;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= b.market.bettingDeadline && !b.market.resolved) return true;
    return false;
  });
  const completed = bets.filter((b) => b.claimed || (b.revealed && b.onChainOutcome !== b.market.result));

  const totalBet = bets.reduce((sum, b) => sum + b.lockedAmount, 0n);
  const wins = bets.filter((b) => b.claimed).length;
  const losses = bets.filter((b) => b.revealed && b.market.resolved && b.onChainOutcome !== b.market.result).length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4 text-center">
          <p className="text-zinc-600 text-[11px] mb-1">Total Bets</p>
          <p className="text-white text-xl font-bold">{bets.length}</p>
        </div>
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4 text-center">
          <p className="text-zinc-600 text-[11px] mb-1">Total Wagered</p>
          <p className="text-[#00e87b] text-xl font-bold font-mono">{formatUSDC(totalBet)}</p>
        </div>
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4 text-center">
          <p className="text-zinc-600 text-[11px] mb-1">Wins</p>
          <p className="text-green-400 text-xl font-bold">{wins}</p>
        </div>
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4 text-center">
          <p className="text-zinc-600 text-[11px] mb-1">Losses</p>
          <p className="text-red-400 text-xl font-bold">{losses}</p>
        </div>
      </div>

      {/* Needs action */}
      {needsAction.length > 0 && (
        <div>
          <h2 className="text-amber-400 text-sm font-medium mb-3">Needs Action ({needsAction.length})</h2>
          <div className="space-y-2">
            {needsAction.map((b) => <BetRow key={b.marketId} bet={b} />)}
          </div>
        </div>
      )}

      {/* Active */}
      {active.length > 0 && (
        <div>
          <h2 className="text-[#00e87b] text-sm font-medium mb-3">Active ({active.length})</h2>
          <div className="space-y-2">
            {active.map((b) => <BetRow key={b.marketId} bet={b} />)}
          </div>
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div>
          <h2 className="text-zinc-500 text-sm font-medium mb-3">Completed ({completed.length})</h2>
          <div className="space-y-2">
            {completed.map((b) => <BetRow key={b.marketId} bet={b} />)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { address } = useAccount();

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  return (
    <div className="min-h-screen bg-[#09090b]">
      <header className="sticky top-0 z-50 border-b border-zinc-800/50 bg-[#09090b]/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-[#00e87b] flex items-center justify-center">
                <span className="text-black text-xs font-bold">S</span>
              </div>
              <span className="text-white font-semibold text-[15px]">ShadowOdds</span>
            </Link>
            <span className="text-zinc-800">/</span>
            <span className="text-zinc-400 text-sm">Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs text-zinc-500 hover:text-white transition-colors">Markets</Link>
            <Link href="/speed" className="text-xs text-zinc-500 hover:text-white transition-colors">Speed</Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">My Bets</h1>
            {address && (
              <p className="text-zinc-500 text-sm font-mono">{address.slice(0, 6)}...{address.slice(-4)}</p>
            )}
          </div>
          {address && usdcBalance !== undefined && (
            <div className="text-right">
              <p className="text-zinc-600 text-[11px] mb-0.5">USDC Balance</p>
              <p className="text-[#00e87b] font-bold font-mono text-lg">{formatUSDC(usdcBalance as bigint)}</p>
            </div>
          )}
        </div>

        <UserBetsList />
      </div>

      <footer className="border-t border-zinc-800/50">
        <div className="max-w-4xl mx-auto px-5 py-6 text-center text-zinc-700 text-xs">
          Monad &middot; Pyth Oracle &middot; Unlink ZK &middot; USDC
        </div>
      </footer>
    </div>
  );
}
