"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { parseUnits, parseAbi } from "viem";
import {
  Outcome,
  OracleType,
  Market,
  createCommitment,
  saveCommitment,
  loadCommitment,
  formatUSDC,
  outcomeLabel,
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

const SPEED_ASSETS = [
  { symbol: "ETH", feedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
  { symbol: "BTC", feedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
  { symbol: "SOL", feedId: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d" },
  { symbol: "DOGE", feedId: "0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c" },
];

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
]);

const PYTH_ABI = parseAbi([
  "function getUpdateFee(bytes[] calldata updateData) view returns (uint256)",
]);

function useLivePrice(feedId: string) {
  const [price, setPrice] = useState<number | null>(null);
  const fetchPrice = useCallback(async () => {
    if (!feedId || feedId === "0x" + "0".repeat(64)) return;
    try {
      const res = await fetch(`${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`);
      const json = await res.json();
      const p = json?.parsed?.[0]?.price;
      if (p) setPrice(Number(p.price) * Math.pow(10, p.expo));
    } catch { /* */ }
  }, [feedId]);

  useEffect(() => {
    fetchPrice();
    const id = setInterval(fetchPrice, 2000);
    return () => clearInterval(id);
  }, [fetchPrice]);

  return price;
}

function useCountdown(deadline: bigint) {
  const [secsLeft, setSecsLeft] = useState<number | null>(null);
  useEffect(() => {
    function tick() {
      const now = Math.floor(Date.now() / 1000);
      setSecsLeft(Math.max(0, Number(deadline) - now));
    }
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [deadline]);
  return secsLeft ?? 0;
}

function formatTime(secs: number): string {
  if (secs <= 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SwipeCard({
  marketId,
  betAmount,
  onSwipe,
}: {
  marketId: number;
  betAmount: string;
  onSwipe: (direction: "left" | "right" | null) => void;
}) {
  const { address } = useAccount();
  const [betStep, setBetStep] = useState<"idle" | "approving" | "betting" | "done">("idle");
  const [revealStep, setRevealStep] = useState<"idle" | "revealing" | "claiming" | "done">("idle");
  const [swipeX, setSwipeX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const startX = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const { data, refetch } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "markets",
    args: [BigInt(marketId)],
    query: { refetchInterval: 2000 },
  });

  // Read on-chain bet state for connected user
  const { data: betData, refetch: refetchBet } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "bets",
    args: address ? [BigInt(marketId), address] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  const onChainBet = betData as [string, bigint, number, boolean, boolean] | undefined;
  const hasBetOnChain = (onChainBet?.[1] ?? 0n) > 0n;
  const betRevealed = onChainBet?.[3] ?? false;
  const betClaimed = onChainBet?.[4] ?? false;
  const betOutcome = onChainBet?.[2] ?? 0;

  const rawFeedId = (data as unknown[])?.[6] as string ?? "";
  const livePrice = useLivePrice(rawFeedId);
  const asset = feedInfo(rawFeedId);

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, SHADOW_ODDS_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  if (!data) {
    return (
      <div className="w-full max-w-sm mx-auto aspect-[3/4] rounded-2xl border border-zinc-800/50 bg-zinc-900/40 shimmer" />
    );
  }

  const rawData = data as [string, bigint, bigint, bigint, number, string, string, bigint, number, boolean, bigint, bigint, bigint];
  const market: Market = {
    id: marketId,
    question: rawData[0],
    bettingDeadline: rawData[1],
    resolutionTime: rawData[2],
    revealDeadline: rawData[3],
    oracleType: rawData[4] as OracleType,
    priceOracle: rawData[5],
    priceFeedId: rawData[6],
    priceThreshold: rawData[7],
    result: rawData[8] as Outcome,
    resolved: rawData[9],
    totalPool: rawData[10],
    yesPool: rawData[11],
    noPool: rawData[12],
  };

  const bettingSecsLeft = useCountdown(market.bettingDeadline);
  const isBettingOpen = bettingSecsLeft > 0 && !market.resolved;
  const thresholdPrice = Number(market.priceThreshold) / 1e8;
  const [savedBet, setSavedBet] = useState<ReturnType<typeof loadCommitment>>(null);
  useEffect(() => {
    setSavedBet(address ? loadCommitment(marketId, address) : null);
  }, [address, marketId, betStep, revealStep]);

  const priceAbove = livePrice !== null && livePrice >= thresholdPrice;

  async function handleQuickBet(direction: Outcome) {
    if (!address) return;
    const amountBigInt = parseUnits(betAmount, 6);

    try {
      const needsApproval = !allowance || (allowance as bigint) < amountBigInt;
      if (needsApproval) {
        setBetStep("approving");
        await writeContractAsync({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [SHADOW_ODDS_ADDRESS, parseUnits("1000000", 6)],
        });
        await refetchAllowance();
      }
      setBetStep("betting");
      const bet = createCommitment(direction, betAmount);
      await writeContractAsync({
        address: SHADOW_ODDS_ADDRESS,
        abi: ShadowOddsABI,
        functionName: "placeBet",
        args: [BigInt(marketId), bet.commitment, bet.amount],
      });
      saveCommitment(marketId, address, bet);
      setBetStep("done");
      refetch();
      // Animate card exit
      setExitDirection(direction === Outcome.YES ? "right" : "left");
      setTimeout(() => onSwipe(direction === Outcome.YES ? "right" : "left"), 400);
    } catch {
      setBetStep("idle");
    }
  }

  async function handleResolve() {
    try {
      const res = await fetch(`${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${market.priceFeedId}&encoding=hex`);
      const pyData = await res.json();
      const vaaHex = `0x${pyData.binary.data[0]}` as `0x${string}`;
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
        args: [BigInt(marketId), [vaaHex]],
        value: fee,
      });
      refetch();
    } catch { /* */ }
  }

  async function handleRevealAndClaim() {
    if (!address || !savedBet) return;
    try {
      if (!betRevealed) {
        setRevealStep("revealing");
        await writeContractAsync({
          address: SHADOW_ODDS_ADDRESS,
          abi: ShadowOddsABI,
          functionName: "revealBet",
          args: [BigInt(marketId), savedBet.secret, savedBet.outcome, savedBet.amount, savedBet.nonce],
        });
        await refetchBet();
      }
      // Claim if user won
      if (savedBet.outcome === market.result) {
        setRevealStep("claiming");
        await writeContractAsync({
          address: SHADOW_ODDS_ADDRESS,
          abi: ShadowOddsABI,
          functionName: "claimWinnings",
          args: [BigInt(marketId)],
        });
      }
      setRevealStep("done");
      refetch();
      refetchBet();
    } catch {
      setRevealStep("idle");
      refetchBet();
    }
  }

  // Swipe gesture handlers
  function handlePointerDown(e: React.PointerEvent) {
    if (betStep !== "idle" || !isBettingOpen) return;
    setIsDragging(true);
    startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isDragging) return;
    setSwipeX(e.clientX - startX.current);
  }

  function handlePointerUp() {
    if (!isDragging) return;
    setIsDragging(false);
    const threshold = 100;
    if (swipeX > threshold && address) {
      handleQuickBet(Outcome.YES);
    } else if (swipeX < -threshold && address) {
      handleQuickBet(Outcome.NO);
    } else {
      setSwipeX(0);
    }
  }

  const rotation = swipeX * 0.05;
  const opacity = Math.max(0.3, 1 - Math.abs(swipeX) / 400);
  const upIndicator = swipeX > 40 ? Math.min(1, (swipeX - 40) / 80) : 0;
  const downIndicator = swipeX < -40 ? Math.min(1, (-swipeX - 40) / 80) : 0;

  const cardStyle = exitDirection
    ? {
        transform: `translateX(${exitDirection === "right" ? 500 : -500}px) rotate(${exitDirection === "right" ? 20 : -20}deg)`,
        opacity: 0,
        transition: "transform 0.4s ease-out, opacity 0.4s ease-out",
      }
    : {
        transform: isDragging ? `translateX(${swipeX}px) rotate(${rotation}deg)` : "none",
        opacity: isDragging ? opacity : 1,
        transition: isDragging ? "none" : "transform 0.3s ease-out, opacity 0.3s ease-out",
      };

  const isBusy = betStep !== "idle";
  const canResolve = bettingSecsLeft === 0 && !market.resolved;

  return (
    <div
      ref={cardRef}
      className="relative w-full max-w-sm mx-auto rounded-2xl border border-zinc-700 bg-zinc-900/80 backdrop-blur-sm overflow-hidden select-none touch-none"
      style={cardStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Swipe indicators */}
      {upIndicator > 0 && (
        <div
          className="absolute inset-0 rounded-2xl border-4 border-green-500 z-10 pointer-events-none flex items-center justify-center"
          style={{ opacity: upIndicator }}
        >
          <span className="text-6xl font-black text-green-500 -rotate-12">UP</span>
        </div>
      )}
      {downIndicator > 0 && (
        <div
          className="absolute inset-0 rounded-2xl border-4 border-red-500 z-10 pointer-events-none flex items-center justify-center"
          style={{ opacity: downIndicator }}
        >
          <span className="text-6xl font-black text-red-500 rotate-12">DOWN</span>
        </div>
      )}

      {/* Card content */}
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-2xl font-bold text-white">{asset.symbol}/USD</span>
            <span className="text-zinc-600 text-sm ml-2">#{marketId}</span>
          </div>
          {isBettingOpen ? (
            <span className="flex items-center gap-1.5 text-sm text-[#00e87b] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00e87b] pulse-live" />
              Live
            </span>
          ) : market.resolved ? (
            <span className="text-sm text-zinc-500">Resolved</span>
          ) : (
            <span className="text-sm text-amber-400">Pending</span>
          )}
        </div>

        {/* Live price — big and central */}
        <div className="text-center py-4">
          <p className="text-zinc-500 text-sm mb-2">Live Price</p>
          <p className={`text-5xl font-bold font-mono ${priceAbove ? "text-green-400" : "text-red-400"}`}>
            ${livePrice?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}
          </p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <span className="text-zinc-600 text-sm">Target:</span>
            <span className="text-[#836EF9] font-bold font-mono text-lg">
              ${thresholdPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>
          {livePrice && (
            <p className={`text-xs mt-1 font-medium ${priceAbove ? "text-green-400" : "text-red-400"}`}>
              Currently {priceAbove ? "above" : "below"} target
            </p>
          )}
        </div>

        {/* Timer + Pool row */}
        <div className="flex items-center justify-between px-2">
          <div className="text-center">
            <p className="text-zinc-600 text-[11px] mb-0.5">Time left</p>
            <p className={`text-lg font-bold font-mono ${bettingSecsLeft <= 10 && bettingSecsLeft > 0 ? "text-red-400" : "text-white"}`}>
              {formatTime(bettingSecsLeft)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-zinc-600 text-[11px] mb-0.5">Pool</p>
            <p className="text-lg font-bold font-mono text-[#00e87b]">{formatUSDC(market.totalPool)}</p>
          </div>
          <div className="text-center">
            <p className="text-zinc-600 text-[11px] mb-0.5">Bet</p>
            <p className="text-lg font-bold font-mono text-white">${betAmount}</p>
          </div>
        </div>

        {/* Action area */}
        {isBettingOpen && betStep === "idle" && address && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleQuickBet(Outcome.NO)}
                disabled={isBusy}
                className="py-4 rounded-xl font-bold text-lg text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 transition-colors"
              >
                DOWN
              </button>
              <button
                onClick={() => handleQuickBet(Outcome.YES)}
                disabled={isBusy}
                className="py-4 rounded-xl font-bold text-lg text-white bg-green-600 hover:bg-green-500 disabled:opacity-40 transition-colors"
              >
                UP
              </button>
            </div>
            <p className="text-center text-zinc-600 text-xs">
              Swipe right for UP, left for DOWN — or tap
            </p>
          </div>
        )}

        {isBettingOpen && betStep === "idle" && !address && (
          <div className="text-center py-2">
            <ConnectButton />
          </div>
        )}

        {isBusy && (
          <div className="text-center py-4">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-[#00e87b] rounded-full spinner mx-auto mb-2" />
            <p className="text-zinc-400 text-sm">
              {betStep === "approving" ? "Approving USDC..." : "Placing hidden bet..."}
            </p>
          </div>
        )}

        {betStep === "done" && !market.resolved && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 text-center">
            <p className="text-[#00e87b] font-semibold">Bet placed. Direction hidden.</p>
            <p className="text-xs text-zinc-500 mt-1">Waiting for resolution...</p>
          </div>
        )}

        {canResolve && (
          <button
            onClick={handleResolve}
            className="w-full py-3.5 rounded-xl font-semibold text-sm text-black bg-[#00e87b] hover:bg-[#00d46f] transition-colors"
          >
            Resolve with Pyth
          </button>
        )}

        {market.resolved && hasBetOnChain && betClaimed && (
          <div className="text-center py-2">
            <p className={`text-3xl font-bold ${market.result === Outcome.YES ? "text-green-400" : "text-red-400"}`}>
              {market.result === Outcome.YES ? "UP" : "DOWN"}
            </p>
            <p className="text-[#00e87b] text-sm font-medium mt-1">Winnings claimed</p>
            <Link href={`/market/${marketId}`} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mt-2 inline-block">
              Details →
            </Link>
          </div>
        )}

        {market.resolved && hasBetOnChain && betRevealed && !betClaimed && (
          <div className="space-y-2">
            <div className="text-center">
              <p className={`text-3xl font-bold ${market.result === Outcome.YES ? "text-green-400" : "text-red-400"}`}>
                {market.result === Outcome.YES ? "UP" : "DOWN"}
              </p>
            </div>
            {savedBet && savedBet.outcome === market.result ? (
              <button
                onClick={handleRevealAndClaim}
                disabled={revealStep !== "idle"}
                className="w-full py-3 rounded-xl font-semibold text-sm text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors"
              >
                {revealStep === "claiming" ? "Claiming..." : "Claim Winnings"}
              </button>
            ) : (
              <p className="text-zinc-500 text-sm text-center">
                You bet {betOutcome === 1 ? "UP" : "DOWN"} — market resolved {market.result === Outcome.YES ? "UP" : "DOWN"}
              </p>
            )}
          </div>
        )}

        {market.resolved && hasBetOnChain && !betRevealed && !betClaimed && savedBet && (
          <div className="space-y-2">
            <div className="text-center">
              <p className={`text-3xl font-bold ${market.result === Outcome.YES ? "text-green-400" : "text-red-400"}`}>
                {market.result === Outcome.YES ? "UP" : "DOWN"}
              </p>
            </div>
            <button
              onClick={handleRevealAndClaim}
              disabled={revealStep !== "idle"}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white bg-[#836EF9] hover:bg-[#7360e0] disabled:opacity-40 transition-colors"
            >
              {revealStep === "revealing" ? "Revealing..." : revealStep === "claiming" ? "Claiming..." : "Reveal & Claim"}
            </button>
          </div>
        )}

        {market.resolved && revealStep === "done" && (
          <div className="text-center py-2">
            <p className={`text-3xl font-bold ${market.result === Outcome.YES ? "text-green-400" : "text-red-400"}`}>
              {market.result === Outcome.YES ? "UP" : "DOWN"}
            </p>
            <p className="text-[#00e87b] text-sm font-medium mt-1">
              {savedBet && savedBet.outcome === market.result ? "Winnings claimed" : "Bet revealed"}
            </p>
          </div>
        )}

        {market.resolved && !hasBetOnChain && !savedBet && (
          <div className="text-center py-2">
            <p className={`text-3xl font-bold ${market.result === Outcome.YES ? "text-green-400" : "text-red-400"}`}>
              {market.result === Outcome.YES ? "UP" : "DOWN"}
            </p>
            <Link href={`/market/${marketId}`} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mt-2 inline-block">
              Details →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SpeedMarketsPage() {
  const { address } = useAccount();
  const { data: marketCount, refetch: refetchCount } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "marketCount",
    query: { refetchInterval: 3000 },
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const count = Number(marketCount ?? 0);
  const startId = Math.max(1, count - 5);
  const marketIds = Array.from({ length: Math.min(count, 6) }, (_, i) => startId + i);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [betAmount, setBetAmount] = useState("10");
  const [showAmountPicker, setShowAmountPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState("");
  const { writeContractAsync: writeCreate } = useWriteContract();

  async function handleNewRound() {
    if (!address) return;
    setCreating(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const deadline = BigInt(now + 120);

      const feedIds = SPEED_ASSETS.map((a) => `ids[]=${a.feedId}`).join("&");
      const res = await fetch(`${PYTH_HERMES_URL}/v2/updates/price/latest?${feedIds}`);
      const json = await res.json();

      const priceMap: Record<string, bigint> = {};
      for (const p of json.parsed ?? []) {
        priceMap[`0x${p.id}`] = BigInt(p.price.price);
      }

      for (const asset of SPEED_ASSETS) {
        const threshold = priceMap[asset.feedId];
        if (!threshold) continue;
        const displayPrice = (Number(threshold) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 });
        setCreateProgress(`${asset.symbol}...`);
        await writeCreate({
          address: SHADOW_ODDS_ADDRESS,
          abi: ShadowOddsABI,
          functionName: "createMarket",
          args: [
            `${asset.symbol} above $${displayPrice}?`,
            deadline,
            deadline,
            1,
            PYTH_ADDRESS,
            asset.feedId as `0x${string}`,
            threshold,
          ],
        });
      }

      await refetchCount();
      setCurrentIndex(0);
    } catch (e) {
      console.error(e);
    }
    setCreating(false);
    setCreateProgress("");
  }

  function handleSwipe(direction: "left" | "right" | null) {
    setTimeout(() => {
      setCurrentIndex((i) => Math.min(i + 1, marketIds.length - 1));
    }, 100);
  }

  function handlePrev() {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }

  function handleNext() {
    setCurrentIndex((i) => Math.min(i + 1, marketIds.length - 1));
  }

  const currentMarketId = marketIds[currentIndex];

  return (
    <div className="min-h-screen bg-[#09090b]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800/50 bg-[#09090b]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-[#00e87b] flex items-center justify-center">
                <span className="text-black text-xs font-bold">S</span>
              </div>
              <span className="text-white font-semibold text-[15px]">ShadowOdds</span>
            </Link>
            <span className="text-zinc-800">/</span>
            <span className="text-[#00e87b] font-medium text-sm">Speed</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs text-zinc-500 hover:text-white transition-colors">
              Markets
            </Link>
            <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-white transition-colors">
              My Bets
            </Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="max-w-lg mx-auto px-5 pt-8 pb-16">
        {/* Title area */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00e87b] pulse-live" />
            <span className="text-sm text-zinc-400">Live on Monad</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">Speed Markets</h1>
          <p className="text-zinc-500 text-sm">Swipe right for UP, left for DOWN</p>
        </div>

        {/* New Round button */}
        {address && (
          <div className="flex justify-center mb-4">
            <button
              onClick={handleNewRound}
              disabled={creating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white disabled:opacity-50 transition-colors border border-zinc-700"
            >
              {creating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-[#00e87b] rounded-full spinner" />
                  <span>Creating {createProgress}</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Round (2 min)
                </>
              )}
            </button>
          </div>
        )}

        {/* Bet amount picker */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="text-zinc-500 text-sm">Bet:</span>
          <div className="flex items-center gap-1">
            {["10", "50", "100", "500"].map((v) => (
              <button
                key={v}
                onClick={() => { setBetAmount(v); setShowAmountPicker(false); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-colors ${
                  betAmount === v
                    ? "bg-[#00e87b] text-black font-medium"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                ${v}
              </button>
            ))}
            <button
              onClick={() => setShowAmountPicker(!showAmountPicker)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                !["10", "50", "100", "500"].includes(betAmount)
                  ? "bg-[#00e87b] text-black font-medium"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              ...
            </button>
          </div>
        </div>

        {showAmountPicker && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <input
              type="number"
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              placeholder="Custom amount"
              className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono text-center focus:outline-none focus:border-[#00e87b]"
            />
            <span className="text-zinc-500 text-sm">USDC</span>
          </div>
        )}

        {/* Card stack */}
        <div className="relative" style={{ minHeight: 520 }}>
          {mounted && (
            <>
              {/* Background cards (stack effect) */}
              {marketIds.slice(currentIndex + 1, currentIndex + 3).map((id, i) => (
                <div
                  key={id}
                  className="absolute inset-0 w-full max-w-sm mx-auto rounded-2xl border border-zinc-800/30 bg-zinc-900/30"
                  style={{
                    transform: `scale(${1 - (i + 1) * 0.04}) translateY(${(i + 1) * 12}px)`,
                    zIndex: -i - 1,
                    left: "50%",
                    marginLeft: "-192px",
                    width: "384px",
                    height: "480px",
                  }}
                />
              ))}

              {/* Active card */}
              {currentMarketId !== undefined && (
                <SwipeCard
                  key={currentMarketId}
                  marketId={currentMarketId}
                  betAmount={betAmount}
                  onSwipe={handleSwipe}
                />
              )}
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 px-4">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="w-10 h-10 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Dots */}
          <div className="flex items-center gap-1.5">
            {marketIds.map((id, i) => (
              <button
                key={id}
                onClick={() => setCurrentIndex(i)}
                className={`rounded-full transition-all ${
                  i === currentIndex
                    ? "w-6 h-2 bg-[#00e87b]"
                    : "w-2 h-2 bg-zinc-700 hover:bg-zinc-500"
                }`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            disabled={currentIndex >= marketIds.length - 1}
            className="w-10 h-10 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50">
        <div className="max-w-6xl mx-auto px-5 py-6 text-center text-zinc-700 text-xs">
          Monad &middot; Pyth Oracle &middot; Unlink ZK &middot; USDC
        </div>
      </footer>
    </div>
  );
}
