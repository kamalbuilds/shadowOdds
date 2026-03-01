"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";
import { parseUnits, formatUnits, parseAbi } from "viem";
import {
  Outcome,
  OracleType,
  Market,
  createCommitment,
  saveCommitment,
  loadCommitment,
  formatUSDC,
  timeRemaining,
  marketStatus,
  outcomeLabel,
} from "@/lib/shadowodds";
import { SHADOW_ODDS_ADDRESS, USDC_ADDRESS, PYTH_ADDRESS, PYTH_HERMES_URL, feedInfo } from "@/lib/wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { UnlinkWallet } from "@/components/UnlinkWallet";
import { PrivacyScore } from "@/components/PrivacyScore";
import { ShadowReceipt } from "@/components/ShadowReceipt";
import { PrivacyTimeline } from "@/components/PrivacyTimeline";
import { PrivateAdapter } from "@/components/PrivateAdapter";
import ShadowOddsABI from "@/lib/ShadowOddsABI.json";

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
]);

const PYTH_ABI = parseAbi([
  "function getUpdateFee(bytes[] calldata updateData) view returns (uint256)",
]);

function pythPriceToUSD(raw: bigint): string {
  const val = Number(raw) / 1e8;
  return val.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function useLivePrice(feedId: string) {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPrice = useCallback(async () => {
    if (!feedId || feedId === "0x" + "0".repeat(64)) { setLoading(false); return; }
    try {
      const res = await fetch(`${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`);
      const json = await res.json();
      const p = json?.parsed?.[0]?.price;
      if (p) setPrice(Number(p.price) * Math.pow(10, p.expo));
    } catch { /* */ }
    finally { setLoading(false); }
  }, [feedId]);

  useEffect(() => {
    fetchPrice();
    const id = setInterval(fetchPrice, 4000);
    return () => clearInterval(id);
  }, [fetchPrice]);

  return { price, loading };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    betting: { label: "Betting Open", cls: "text-[#00e87b] bg-[#00e87b]/10" },
    pending: { label: "Pending", cls: "text-amber-400 bg-amber-400/10" },
    reveal: { label: "Reveal Window", cls: "text-[#836EF9] bg-[#836EF9]/10" },
    resolved: { label: "Resolved", cls: "text-zinc-400 bg-zinc-800" },
  };
  const s = map[status] ?? map.resolved;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${s.cls}`}>
      {status === "betting" && <span className="w-1 h-1 rounded-full bg-[#00e87b] pulse-live" />}
      {s.label}
    </span>
  );
}

function USDCFaucet({ address }: { address: `0x${string}` }) {
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<"idle" | "minting" | "done" | "error">("idle");

  async function handleMint() {
    setStatus("minting");
    try {
      await writeContractAsync({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [address, parseUnits("10000", 6)],
      });
      setStatus("done");
    } catch { setStatus("error"); }
  }

  if (status === "done") return <p className="text-xs text-[#00e87b]">+10,000 USDC minted</p>;

  return (
    <button
      onClick={handleMint}
      disabled={status === "minting"}
      className="text-xs text-[#00e87b] hover:text-[#00d46f] transition-colors disabled:opacity-50"
    >
      {status === "minting" ? "Minting..." : "Get 10k USDC"}
    </button>
  );
}

function ResolveWithPythButton({ marketId, feedId, onResolved }: { marketId: number; feedId: string; onResolved: () => void }) {
  const [status, setStatus] = useState<"idle" | "fetching" | "resolving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  async function handleResolve() {
    setStatus("fetching");
    setMsg("Fetching Pyth price...");
    try {
      const res = await fetch(`${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}&encoding=hex`);
      const data = await res.json();
      const vaaHex = `0x${data.binary.data[0]}` as `0x${string}`;
      const livePrice = Number(data.parsed[0].price.price) * Math.pow(10, data.parsed[0].price.expo);
      const asset = feedInfo(feedId);
      setMsg(`${asset.symbol} at $${livePrice.toFixed(2)}`);

      const fee = await publicClient!.readContract({
        address: PYTH_ADDRESS,
        abi: PYTH_ABI,
        functionName: "getUpdateFee",
        args: [[vaaHex]],
      });

      setStatus("resolving");
      await writeContractAsync({
        address: SHADOW_ODDS_ADDRESS,
        abi: ShadowOddsABI,
        functionName: "resolveWithPyth",
        args: [BigInt(marketId), [vaaHex]],
        value: fee,
      });

      setStatus("done");
      setMsg(`Resolved at $${livePrice.toFixed(2)}`);
      setTimeout(onResolved, 1500);
    } catch (e: unknown) {
      setStatus("error");
      const err = e instanceof Error ? e.message : "Unknown error";
      setMsg(err.includes("User rejected") ? "Rejected" : err.slice(0, 100));
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-zinc-400 text-sm">
        Anyone can trigger resolution by submitting the latest Pyth price proof.
      </p>
      <button
        onClick={handleResolve}
        disabled={status === "fetching" || status === "resolving"}
        className="w-full py-3.5 rounded-lg font-semibold text-sm text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors"
      >
        {(status === "fetching" || status === "resolving")
          ? (status === "fetching" ? "Fetching..." : "Resolving...")
          : status === "done" ? "Resolved" : "Resolve with Pyth"}
      </button>
      {msg && (
        <p className={`text-xs font-mono ${status === "error" ? "text-red-400" : status === "done" ? "text-[#00e87b]" : "text-zinc-500"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

function BetForm({ market, marketId, onBetPlaced }: { market: Market; marketId: number; onBetPlaced: () => void }) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState<Outcome | null>(null);
  const [step, setStep] = useState<"idle" | "approving" | "betting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const amountBigInt = amount ? parseUnits(amount, 6) : 0n;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, SHADOW_ODDS_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const { writeContractAsync } = useWriteContract();
  const needsApproval = allowance !== undefined && amountBigInt > 0n && allowance < amountBigInt;

  async function handlePlaceBet() {
    if (!address || !selectedOutcome || !amount || parseFloat(amount) <= 0) return;
    setErrorMsg("");
    try {
      if (needsApproval) {
        setStep("approving");
        await writeContractAsync({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [SHADOW_ODDS_ADDRESS, amountBigInt],
        });
        await refetchAllowance();
      }
      setStep("betting");
      const bet = createCommitment(selectedOutcome, amount);
      await writeContractAsync({
        address: SHADOW_ODDS_ADDRESS,
        abi: ShadowOddsABI,
        functionName: "placeBet",
        args: [BigInt(marketId), bet.commitment, bet.amount],
      });
      saveCommitment(marketId, address, bet);
      setStep("done");
      onBetPlaced();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setErrorMsg(msg.includes("User rejected") ? "Transaction rejected" : msg.slice(0, 120));
      setStep("error");
    }
  }

  if (step === "done") {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-5 text-center">
        <p className="text-[#00e87b] font-semibold mb-1">Bet placed</p>
        <p className="text-zinc-400 text-sm mb-3">
          Your {selectedOutcome === Outcome.YES ? "YES" : "NO"} position is hidden on-chain.
        </p>
        <p className="text-xs text-zinc-600 font-mono">
          Direction: <span className="redacted px-2">████</span> hidden
        </p>
      </div>
    );
  }

  const isBusy = step === "approving" || step === "betting";

  return (
    <div className="space-y-4">
      {address && usdcBalance !== undefined && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">USDC balance</span>
          <div className="flex items-center gap-3">
            <span className="text-zinc-300 font-mono">{formatUSDC(usdcBalance as bigint)}</span>
            <USDCFaucet address={address} />
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-zinc-500 mb-2 block">Position</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSelectedOutcome(Outcome.YES)}
            className={`py-3.5 rounded-lg border font-semibold transition-colors ${
              selectedOutcome === Outcome.YES
                ? "border-green-500/60 bg-green-500/10 text-green-400"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
            }`}
          >
            YES
          </button>
          <button
            onClick={() => setSelectedOutcome(Outcome.NO)}
            className={`py-3.5 rounded-lg border font-semibold transition-colors ${
              selectedOutcome === Outcome.NO
                ? "border-red-500/60 bg-red-500/10 text-red-400"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
            }`}
          >
            NO
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs text-zinc-500 mb-2 block">Amount (USDC)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-zinc-600"
        />
        <div className="flex gap-1.5 mt-2">
          {["10", "50", "100", "500"].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              className="px-2.5 py-1 rounded text-xs text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
            >
              ${v}
            </button>
          ))}
        </div>
      </div>

      {selectedOutcome !== null && amount && (
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-3 text-sm space-y-1">
          <div className="flex justify-between text-zinc-500">
            <span>Visible on-chain</span>
            <span className="text-white font-mono">${amount}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Hidden on-chain</span>
            <span className="text-[#00e87b] font-mono">direction</span>
          </div>
        </div>
      )}

      {!address ? (
        <div className="text-center py-2">
          <ConnectButton />
        </div>
      ) : (
        <button
          onClick={handlePlaceBet}
          disabled={isBusy || !selectedOutcome || !amount || parseFloat(amount || "0") <= 0}
          className="w-full py-3.5 rounded-lg font-semibold text-sm text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors"
        >
          {isBusy
            ? (step === "approving" ? "Approving..." : "Placing bet...")
            : needsApproval ? "Approve & Bet" : "Place Hidden Bet"}
        </button>
      )}

      {step === "error" && (
        <p className="text-xs text-red-400">{errorMsg || "Transaction failed"}</p>
      )}
    </div>
  );
}

function RevealForm({ market, marketId, onRevealed }: { market: Market; marketId: number; onRevealed: () => void }) {
  const { address } = useAccount();
  const [step, setStep] = useState<"idle" | "revealing" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const { writeContractAsync } = useWriteContract();
  const savedBet = address ? loadCommitment(marketId, address) : null;

  const { data: betData } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "bets",
    args: address ? [BigInt(marketId), address] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  const onChainBet = betData as [string, bigint, number, boolean, boolean] | undefined;
  const alreadyRevealed = onChainBet?.[3] ?? false;

  async function handleReveal() {
    if (!address || !savedBet) return;
    setErrorMsg("");
    setStep("revealing");
    try {
      await writeContractAsync({
        address: SHADOW_ODDS_ADDRESS,
        abi: ShadowOddsABI,
        functionName: "revealBet",
        args: [BigInt(marketId), savedBet.secret, savedBet.outcome, savedBet.amount, savedBet.nonce],
      });
      setStep("done");
      onRevealed();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setErrorMsg(msg.includes("User rejected") ? "Rejected" : msg.includes("AlreadyRevealed") ? "Already revealed" : msg.slice(0, 120));
      setStep("error");
    }
  }

  if (!savedBet) {
    return (
      <div className="text-center py-4">
        <p className="text-zinc-500 text-sm">No saved bet found for this wallet.</p>
        <p className="text-zinc-600 text-xs mt-1">Commitment data is in localStorage.</p>
      </div>
    );
  }

  if (alreadyRevealed || step === "done") {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 text-center">
        <p className="text-[#836EF9] font-semibold mb-1">Bet revealed</p>
        <p className="text-zinc-400 text-sm">
          Your {outcomeLabel(savedBet.outcome)} position is public now.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-3 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Position</span>
          <span className={savedBet.outcome === Outcome.YES ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
            {outcomeLabel(savedBet.outcome)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Amount</span>
          <span className="text-white font-mono">{formatUSDC(savedBet.amount)}</span>
        </div>
      </div>

      {!address ? <ConnectButton /> : (
        <button
          onClick={handleReveal}
          disabled={step === "revealing"}
          className="w-full py-3.5 rounded-lg font-semibold text-sm text-white bg-[#836EF9] hover:bg-[#7360e0] disabled:opacity-40 transition-colors"
        >
          {step === "revealing" ? "Revealing..." : "Reveal My Bet"}
        </button>
      )}

      {step === "error" && <p className="text-xs text-red-400">{errorMsg}</p>}
    </div>
  );
}

function ClaimForm({ marketId, market, onClaimed }: { marketId: number; market: Market; onClaimed: () => void }) {
  const { address } = useAccount();
  const [step, setStep] = useState<"idle" | "claiming" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const { writeContractAsync } = useWriteContract();

  const { data: betData, refetch } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "bets",
    args: address ? [BigInt(marketId), address] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  const bet = betData as [string, bigint, number, boolean, boolean] | undefined;
  const revealed = bet?.[3] ?? false;
  const claimed = bet?.[4] ?? false;
  const betOutcome = bet?.[2] as Outcome | undefined;
  const isWinner = betOutcome !== undefined && betOutcome === market.result && market.result !== Outcome.PENDING;

  async function handleClaim() {
    setStep("claiming");
    try {
      await writeContractAsync({
        address: SHADOW_ODDS_ADDRESS,
        abi: ShadowOddsABI,
        functionName: "claimWinnings",
        args: [BigInt(marketId)],
      });
      setStep("done");
      onClaimed();
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setErrorMsg(msg.includes("User rejected") ? "Rejected" : msg.slice(0, 120));
      setStep("error");
    }
  }

  if (step === "done") {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-5 text-center">
        <p className="text-[#00e87b] font-semibold mb-1">Winnings claimed</p>
        <p className="text-zinc-400 text-sm">USDC sent to your wallet.</p>
        <p className="text-zinc-600 text-xs mt-3">
          Shield your winnings below to break the wallet-to-win link.
        </p>
      </div>
    );
  }
  if (claimed) return <p className="text-zinc-500 text-center py-4">Already claimed.</p>;
  if (!revealed) return <p className="text-amber-400 text-sm text-center py-4">Reveal your bet first.</p>;
  if (!isWinner) return <p className="text-zinc-500 text-sm text-center py-4">You bet {outcomeLabel(betOutcome!)} — market resolved {outcomeLabel(market.result)}.</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#00e87b]/20 bg-[#00e87b]/5 p-4 text-center">
        <p className="text-xs text-zinc-500 mb-1">You won</p>
        <p className="text-xl font-bold text-[#00e87b]">{outcomeLabel(betOutcome!)}</p>
        <p className="text-xs text-zinc-600 mt-1">1% protocol fee on profits</p>
      </div>
      {!address ? <ConnectButton /> : (
        <button
          onClick={handleClaim}
          disabled={step === "claiming"}
          className="w-full py-3.5 rounded-lg font-semibold text-sm text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors"
        >
          {step === "claiming" ? "Claiming..." : "Claim Winnings"}
        </button>
      )}
      {step === "error" && <p className="text-xs text-red-400">{errorMsg}</p>}
    </div>
  );
}

function PrivacyPanel({ market }: { market: Market }) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5">
      <h3 className="text-white font-semibold mb-3 text-sm">Privacy model</h3>
      <div className="space-y-2.5">
        {[
          { hidden: false, label: "Amount locked", sub: "Visible — needed for settlement" },
          { hidden: true, label: "YES/NO direction", sub: "Hidden via commit-reveal" },
          { hidden: true, label: "Your secret key", sub: "Never leaves your browser" },
        ].map((item) => (
          <div key={item.label} className="flex items-start gap-2.5">
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${item.hidden ? "bg-[#00e87b]" : "bg-red-400"}`} />
            <div>
              <p className="text-sm text-zinc-300">{item.label}</p>
              <p className="text-xs text-zinc-600">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pool breakdown */}
      <div className="mt-4 pt-4 border-t border-zinc-800/40">
        <p className="text-xs text-zinc-500 mb-2">Pool breakdown</p>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">YES pool</span>
            {market.resolved
              ? <span className="font-mono text-green-400">{formatUSDC(market.yesPool)}</span>
              : <span className="redacted px-2 text-xs">████</span>}
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">NO pool</span>
            {market.resolved
              ? <span className="font-mono text-red-400">{formatUSDC(market.noPool)}</span>
              : <span className="redacted px-2 text-xs">████</span>}
          </div>
          <div className="flex justify-between pt-1.5 border-t border-zinc-800/40">
            <span className="text-zinc-400">Total</span>
            <span className="font-mono text-[#00e87b] font-medium">{formatUSDC(market.totalPool)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const marketId = parseInt(id, 10);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, isLoading, isError, refetch } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "markets",
    args: [BigInt(marketId)],
    query: { refetchInterval: 4000 },
  });

  const rawFeedId = (data as unknown[])?.[6] as string ?? "";
  const { price: livePrice, loading: livePriceLoading } = useLivePrice(rawFeedId);
  const assetInfo = feedInfo(rawFeedId);

  const triggerRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="flex items-center gap-3 text-zinc-500 text-sm">
          <span className="w-4 h-4 border-2 border-zinc-600 border-t-transparent rounded-full spinner" />
          Loading...
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-3">Market not found</p>
          <Link href="/" className="text-[#00e87b] text-sm hover:underline">Back to markets</Link>
        </div>
      </div>
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

  const status = marketStatus(market);
  const isPriceFeed = market.oracleType === OracleType.PRICE_FEED;
  const thresholdUSD = pythPriceToUSD(market.priceThreshold);

  return (
    <div className="min-h-screen bg-[#09090b]">
      <header className="sticky top-0 z-50 border-b border-zinc-800/50 bg-[#09090b]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-zinc-500 hover:text-white transition-colors text-sm flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Markets
            </Link>
            <span className="text-zinc-800">/</span>
            <span className="text-zinc-400 text-sm">#{marketId}</span>
          </div>
          <ConnectButton />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main */}
          <div className="lg:col-span-2 space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <StatusBadge status={status} />
                {isPriceFeed && (
                  <span className="text-xs text-[#836EF9] px-2 py-0.5 rounded-md bg-[#836EF9]/10">
                    Pyth Oracle
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-semibold text-white leading-snug">{market.question}</h1>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4">
                <p className="text-xs text-zinc-500 mb-1">Total Pool</p>
                <p className="text-[#00e87b] font-bold text-lg font-mono">{formatUSDC(market.totalPool)}</p>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4">
                <p className="text-xs text-zinc-500 mb-1">{status === "betting" ? "Closes in" : "Closed"}</p>
                <p className="text-white font-bold text-lg font-mono">{timeRemaining(market.bettingDeadline)}</p>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4">
                <p className="text-xs text-zinc-500 mb-1">Reveal window</p>
                <p className="text-white font-bold text-lg font-mono">{timeRemaining(market.revealDeadline)}</p>
              </div>
            </div>

            {/* Live price */}
            {isPriceFeed && (
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#836EF9] pulse-live" />
                      {assetInfo.symbol}/USD — Pyth
                    </p>
                    {livePriceLoading ? (
                      <div className="h-7 w-32 bg-zinc-800 rounded shimmer" />
                    ) : (
                      <p className="text-2xl font-bold font-mono text-white">
                        ${livePrice?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-500 mb-1">Threshold</p>
                    <p className="text-lg font-bold font-mono text-[#836EF9]">{thresholdUSD}</p>
                    {livePrice && (
                      <p className={`text-xs mt-0.5 font-medium ${livePrice >= Number(market.priceThreshold) / 1e8 ? "text-green-400" : "text-red-400"}`}>
                        {livePrice >= Number(market.priceThreshold) / 1e8 ? "Would resolve YES" : "Would resolve NO"}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Resolved banner */}
            {market.resolved && (
              <div className={`rounded-lg border p-5 flex items-center gap-4 ${
                market.result === Outcome.YES ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"
              }`}>
                <div>
                  <p className="text-sm text-zinc-400">Resolved</p>
                  <p className={`text-3xl font-bold ${market.result === Outcome.YES ? "text-green-400" : "text-red-400"}`}>
                    {outcomeLabel(market.result)}
                  </p>
                </div>
              </div>
            )}

            {/* Action */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-6">
              <h2 className="text-white font-semibold mb-4">
                {status === "betting" && "Place your bet"}
                {status === "pending" && (isPriceFeed ? "Resolve via Pyth" : "Waiting for resolution")}
                {status === "reveal" && "Reveal & Claim"}
                {status === "resolved" && "Claim winnings"}
              </h2>

              {status === "betting" && <BetForm market={market} marketId={marketId} onBetPlaced={triggerRefresh} />}
              {status === "pending" && isPriceFeed && <ResolveWithPythButton key={refreshKey} marketId={marketId} feedId={market.priceFeedId} onResolved={triggerRefresh} />}
              {status === "pending" && !isPriceFeed && (
                <p className="text-zinc-500 text-center py-6">Waiting for admin resolution.</p>
              )}
              {status === "reveal" && (
                <div className="space-y-4">
                  <RevealForm market={market} marketId={marketId} onRevealed={triggerRefresh} />
                  <ClaimForm key={refreshKey} marketId={marketId} market={market} onClaimed={triggerRefresh} />
                </div>
              )}
              {status === "resolved" && <ClaimForm key={refreshKey} marketId={marketId} market={market} onClaimed={triggerRefresh} />}
            </div>

            {/* Details */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5">
              <h3 className="text-white font-semibold mb-3 text-sm">Details</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {[
                  { label: "Oracle", value: isPriceFeed ? "Pyth (trustless)" : "Admin" },
                  { label: "Settlement", value: "USDC" },
                  { label: "Privacy", value: "Commit-reveal" },
                  { label: "Network", value: "Monad testnet" },
                  { label: "Contract", value: `${SHADOW_ODDS_ADDRESS?.slice(0, 10)}...` },
                  { label: "Fee", value: "1% on profits" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between py-1 border-b border-zinc-800/30">
                    <span className="text-zinc-500">{label}</span>
                    <span className="text-zinc-300 font-mono text-xs">{value}</span>
                  </div>
                ))}
              </div>
              <a
                href={`https://testnet.monadexplorer.com/address/${SHADOW_ODDS_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                View on Explorer →
              </a>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <PrivacyScore marketId={marketId} />
            <ShadowReceipt marketId={marketId} market={market} />
            <PrivacyPanel market={market} />
            <PrivateAdapter marketId={marketId} bettingOpen={status === "betting"} marketResolved={market.resolved} marketResult={market.result} />
            <UnlinkWallet />
            <PrivacyTimeline />
          </div>
        </div>
      </div>
    </div>
  );
}
