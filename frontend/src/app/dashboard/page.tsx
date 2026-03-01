"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWriteContract, usePublicClient, useSendTransaction } from "wagmi";
import { parseAbi, formatUnits, encodeFunctionData, parseEther } from "viem";
import { useBurner, useUnlinkBalance } from "@unlink-xyz/react";
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

const SHADOW_ABI = parseAbi([
  "function revealBet(uint256 marketId, bytes32 secret, uint8 outcome, uint256 amount, uint256 nonce)",
  "function claimWinnings(uint256 marketId)",
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

// ─── Normal Bet Row ─────────────────────────────────────────────────

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

  return (
    <BetRowUI
      bet={bet}
      asset={asset}
      isWinner={isWinner}
      isLoser={isLoser}
      bettingOpen={bettingOpen}
      canResolve={canResolve}
      canReveal={!!canReveal}
      canClaim={!!canClaim}
      step={step}
      onResolve={handleResolve}
      onReveal={handleReveal}
      onClaim={handleClaim}
      anonymous={false}
    />
  );
}

// ─── Burner Bet Row ─────────────────────────────────────────────────

function BurnerBetRow({ bet, burnerAddress }: { bet: UserBet; burnerAddress: string }) {
  const { send: burnerSend, getBalance } = useBurner();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient();
  const [step, setStep] = useState<"idle" | "resolving" | "revealing" | "claiming" | "done">("idle");

  const savedBet = loadCommitment(bet.marketId, burnerAddress);
  const asset = feedInfo(bet.market.priceFeedId);
  const isWinner = bet.revealed && bet.market.resolved && bet.onChainOutcome === bet.market.result;
  const isLoser = bet.revealed && bet.market.resolved && bet.onChainOutcome !== bet.market.result;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const bettingOpen = now < bet.market.bettingDeadline && !bet.market.resolved;
  const canResolve = now >= bet.market.bettingDeadline && !bet.market.resolved;
  const canReveal = bet.market.resolved && !bet.revealed && savedBet && now < bet.market.revealDeadline;
  const canClaim = bet.market.resolved && bet.revealed && !bet.claimed && isWinner;

  async function ensureGas() {
    const nativeBal = await getBalance(burnerAddress);
    if (nativeBal < parseEther("0.01")) {
      await sendTransactionAsync({
        to: burnerAddress as `0x${string}`,
        value: parseEther("0.05"),
      });
    }
  }

  async function handleResolve() {
    try {
      setStep("resolving");
      const res = await fetch(`${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${bet.market.priceFeedId}&encoding=hex`);
      const data = await res.json();
      const vaaHex = `0x${data.binary.data[0]}` as `0x${string}`;
      // Resolution can be called by anyone — use burner to keep it anonymous
      await ensureGas();
      const fee = await publicClient!.readContract({
        address: PYTH_ADDRESS,
        abi: PYTH_ABI,
        functionName: "getUpdateFee",
        args: [[vaaHex]],
      });
      await burnerSend.execute({
        index: 0,
        tx: {
          to: SHADOW_ODDS_ADDRESS,
          data: encodeFunctionData({
            abi: ShadowOddsABI as readonly unknown[],
            functionName: "resolveWithPyth",
            args: [BigInt(bet.marketId), [vaaHex]],
          }),
          value: fee as bigint,
        },
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
      await ensureGas();
      await burnerSend.execute({
        index: 0,
        tx: {
          to: SHADOW_ODDS_ADDRESS,
          data: encodeFunctionData({
            abi: SHADOW_ABI,
            functionName: "revealBet",
            args: [BigInt(bet.marketId), savedBet.secret, savedBet.outcome, savedBet.amount, savedBet.nonce],
          }),
        },
      });
      setStep("done");
    } catch {
      setStep("idle");
    }
  }

  async function handleClaim() {
    try {
      setStep("claiming");
      await ensureGas();
      await burnerSend.execute({
        index: 0,
        tx: {
          to: SHADOW_ODDS_ADDRESS,
          data: encodeFunctionData({
            abi: SHADOW_ABI,
            functionName: "claimWinnings",
            args: [BigInt(bet.marketId)],
          }),
        },
      });
      setStep("done");
    } catch {
      setStep("idle");
    }
  }

  return (
    <BetRowUI
      bet={bet}
      asset={asset}
      isWinner={isWinner}
      isLoser={isLoser}
      bettingOpen={bettingOpen}
      canResolve={canResolve}
      canReveal={!!canReveal}
      canClaim={!!canClaim}
      step={step}
      onResolve={handleResolve}
      onReveal={handleReveal}
      onClaim={handleClaim}
      anonymous={true}
    />
  );
}

// ─── Shared Bet Row UI ──────────────────────────────────────────────

function BetRowUI({
  bet, asset, isWinner, isLoser, bettingOpen, canResolve, canReveal, canClaim, step, onResolve, onReveal, onClaim, anonymous,
}: {
  bet: UserBet;
  asset: { symbol: string };
  isWinner: boolean;
  isLoser: boolean;
  bettingOpen: boolean;
  canResolve: boolean;
  canReveal: boolean;
  canClaim: boolean;
  step: string;
  onResolve: () => void;
  onReveal: () => void;
  onClaim: () => void;
  anonymous: boolean;
}) {
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
    <div className={`rounded-lg border p-4 ${anonymous ? "border-amber-500/20 bg-amber-500/5" : "border-zinc-800/60 bg-zinc-900/40"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Link href={`/market/${bet.marketId}`} className="text-white font-medium hover:text-[#00e87b] transition-colors">
            {asset.symbol !== "???" ? `${asset.symbol}/USD` : bet.market.question.slice(0, 30)}
          </Link>
          <span className="text-zinc-600 text-xs">#{bet.marketId}</span>
          {anonymous && (
            <span className="text-[11px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
              Burner
            </span>
          )}
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

      {step === "done" ? (
        <p className="text-[#00e87b] text-xs text-center">Done — refreshing...</p>
      ) : (
        <div className="flex gap-2">
          {canResolve && bet.market.oracleType === OracleType.PRICE_FEED && (
            <button
              onClick={onResolve}
              disabled={step !== "idle"}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors"
            >
              {step === "resolving" ? "Resolving..." : "Resolve"}
            </button>
          )}
          {canReveal && (
            <button
              onClick={onReveal}
              disabled={step !== "idle"}
              className={`flex-1 py-2 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors ${
                anonymous ? "text-black bg-amber-400 hover:bg-amber-500" : "text-white bg-[#836EF9] hover:bg-[#7360e0]"
              }`}
            >
              {step === "revealing" ? "Revealing..." : anonymous ? "Reveal (burner)" : "Reveal"}
            </button>
          )}
          {canClaim && (
            <button
              onClick={onClaim}
              disabled={step !== "idle"}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors"
            >
              {step === "claiming" ? "Claiming..." : anonymous ? "Claim (burner)" : "Claim"}
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

// ─── Bet Lists ──────────────────────────────────────────────────────

function useFetchBets(bettor: string | undefined) {
  const publicClient = usePublicClient();
  const [bets, setBets] = useState<UserBet[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);

  const { data: marketCount } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "marketCount",
  });

  const fetchBets = useCallback(async () => {
    if (!bettor || !publicClient || !marketCount) return;
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
            args: [BigInt(i), bettor],
          }),
        ]);

        const bd = betData as [string, bigint, number, boolean, boolean];
        if (bd[1] === 0n) continue;

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
          hasSavedBet: !!loadCommitment(i, bettor),
        });
      } catch { /* skip */ }
    }

    setBets(userBets.reverse());
    setInitialLoad(false);
  }, [bettor, publicClient, marketCount]);

  useEffect(() => {
    fetchBets();
    const id = setInterval(fetchBets, 30000);
    return () => clearInterval(id);
  }, [fetchBets]);

  return { bets, loading: initialLoad, refresh: fetchBets };
}

function categorizeBets(bets: UserBet[]) {
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
  return { active, needsAction, completed };
}

function BetSection({ title, bets, Row }: { title: string; bets: UserBet[]; Row: React.ComponentType<{ bet: UserBet }> }) {
  if (bets.length === 0) return null;
  const color = title.includes("Action") ? "text-amber-400" : title.includes("Active") ? "text-[#00e87b]" : "text-zinc-500";
  return (
    <div>
      <h2 className={`${color} text-sm font-medium mb-3`}>{title} ({bets.length})</h2>
      <div className="space-y-2">
        {bets.map((b) => <Row key={b.marketId} bet={b} />)}
      </div>
    </div>
  );
}

function WalletBetsSection({ bets }: { bets: UserBet[] }) {
  if (bets.length === 0) return null;
  const { active, needsAction, completed } = categorizeBets(bets);
  return (
    <div className="space-y-6">
      <BetSection title="Needs Action" bets={needsAction} Row={BetRow} />
      <BetSection title="Active" bets={active} Row={BetRow} />
      <BetSection title="Completed" bets={completed} Row={BetRow} />
    </div>
  );
}

function BurnerBetsSection({ bets, burnerAddr }: { bets: UserBet[]; burnerAddr: string }) {
  const { sweepToPool: burnerSweep, getTokenBalance } = useBurner();
  const [sweeping, setSweeping] = useState(false);
  const [burnerUsdcBal, setBurnerUsdcBal] = useState<bigint | null>(null);

  useEffect(() => {
    if (!burnerAddr) return;
    getTokenBalance(burnerAddr, USDC_ADDRESS).then(setBurnerUsdcBal).catch(() => setBurnerUsdcBal(0n));
  }, [burnerAddr]);

  async function handleSweep() {
    setSweeping(true);
    try {
      await burnerSweep.execute({ index: 0, params: { token: USDC_ADDRESS } });
      setBurnerUsdcBal(0n);
    } catch { /* */ }
    setSweeping(false);
  }

  const BurnerRow = ({ bet }: { bet: UserBet }) => <BurnerBetRow bet={bet} burnerAddress={burnerAddr} />;

  if (bets.length === 0 && (!burnerUsdcBal || burnerUsdcBal === 0n)) return null;

  const { active, needsAction, completed } = categorizeBets(bets);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20 font-medium">
            Burner
          </span>
          <span className="text-zinc-500 font-mono text-xs">{burnerAddr.slice(0, 6)}...{burnerAddr.slice(-4)}</span>
          {burnerUsdcBal !== null && burnerUsdcBal > 0n && (
            <span className="text-white font-mono text-xs">{formatUnits(burnerUsdcBal, 6)} USDC</span>
          )}
        </div>
        {burnerUsdcBal !== null && burnerUsdcBal > 0n && (
          <button
            onClick={handleSweep}
            disabled={sweeping}
            className="text-xs text-[#836EF9] hover:text-[#a08bff] disabled:opacity-40 transition-colors"
          >
            {sweeping ? "Sweeping..." : "Sweep to Pool"}
          </button>
        )}
      </div>

      {bets.length > 0 && (
        <div className="space-y-6">
          <BetSection title="Needs Action" bets={needsAction} Row={BurnerRow} />
          <BetSection title="Active" bets={active} Row={BurnerRow} />
          <BetSection title="Completed" bets={completed} Row={BurnerRow} />
        </div>
      )}
    </div>
  );
}

// ─── Dashboard Page ─────────────────────────────────────────────────

export default function DashboardPage() {
  const { address } = useAccount();
  const { burners } = useBurner();
  const { balance: shieldedBalance } = useUnlinkBalance(USDC_ADDRESS);
  const activeBurner = burners[0];
  const burnerAddr = activeBurner?.address;

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Single fetch per address — no duplicates
  const { bets: walletBets, loading: walletLoading } = useFetchBets(address);
  const { bets: burnerBets, loading: burnerLoading } = useFetchBets(burnerAddr);

  const allBets = [...walletBets, ...burnerBets];
  const totalBet = allBets.reduce((sum, b) => sum + b.lockedAmount, 0n);
  const wins = allBets.filter((b) => b.claimed).length;
  const losses = allBets.filter((b) => b.revealed && b.market.resolved && b.onChainOutcome !== b.market.result).length;
  const isLoading = (walletLoading && walletBets.length === 0) || (burnerAddr && burnerLoading && burnerBets.length === 0);

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
            <div className="text-right space-y-1">
              <div>
                <p className="text-zinc-600 text-[11px]">Wallet USDC</p>
                <p className="text-[#00e87b] font-bold font-mono">{formatUSDC(usdcBalance as bigint)}</p>
              </div>
              {shieldedBalance !== undefined && shieldedBalance > 0n && (
                <div>
                  <p className="text-zinc-600 text-[11px]">Shielded</p>
                  <p className="text-[#836EF9] font-bold font-mono">{formatUnits(shieldedBalance, 6)} USDC</p>
                </div>
              )}
            </div>
          )}
        </div>

        {!address ? (
          <div className="text-center py-16">
            <p className="text-zinc-400 mb-4">Connect your wallet to see your bets</p>
            <ConnectButton />
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-zinc-500 text-sm">
            <span className="w-4 h-4 border-2 border-zinc-600 border-t-[#00e87b] rounded-full spinner" />
            Loading your bets...
          </div>
        ) : allBets.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-400 mb-2">No bets placed yet</p>
            <div className="flex justify-center gap-3">
              <Link href="/" className="text-sm text-[#00e87b] hover:underline">Browse markets</Link>
              <Link href="/speed" className="text-sm text-[#836EF9] hover:underline">Speed markets</Link>
            </div>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-8">
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4 text-center">
                <p className="text-zinc-600 text-[11px] mb-1">Total Bets</p>
                <p className="text-white text-xl font-bold">{allBets.length}</p>
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

            {/* Burner Bets */}
            {burnerAddr && burnerBets.length > 0 && (
              <div className="mb-8">
                <h2 className="text-amber-400 text-sm font-semibold mb-4 flex items-center gap-2">
                  Anonymous Bets
                  <span className="text-[11px] text-amber-400/60 font-normal">via burner wallet</span>
                </h2>
                <BurnerBetsSection bets={burnerBets} burnerAddr={burnerAddr} />
              </div>
            )}

            {/* Wallet Bets */}
            {walletBets.length > 0 && (
              <div>
                {burnerBets.length > 0 && (
                  <h2 className="text-zinc-400 text-sm font-semibold mb-4">Wallet Bets</h2>
                )}
                <WalletBetsSection bets={walletBets} />
              </div>
            )}
          </>
        )}
      </div>

      <footer className="border-t border-zinc-800/50">
        <div className="max-w-4xl mx-auto px-5 py-6 text-center text-zinc-700 text-xs">
          Monad &middot; Pyth Oracle &middot; Unlink ZK &middot; USDC
        </div>
      </footer>
    </div>
  );
}
