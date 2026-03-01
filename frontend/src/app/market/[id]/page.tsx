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

/** Convert Pyth raw price to human-readable USD (ETH/USD expo=-8) */
function pythPriceToUSD(raw: bigint): string {
  const val = Number(raw) / 1e8;
  return val.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

// ---- Live Price from Pyth Hermes (works with any feed) ----
function useLivePrice(feedId: string) {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPrice = useCallback(async () => {
    if (!feedId || feedId === "0x" + "0".repeat(64)) { setLoading(false); return; }
    try {
      const res = await fetch(
        `${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`
      );
      const json = await res.json();
      const p = json?.parsed?.[0]?.price;
      if (p) setPrice(Number(p.price) * Math.pow(10, p.expo));
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [feedId]);

  useEffect(() => {
    fetchPrice();
    const id = setInterval(fetchPrice, 4000);
    return () => clearInterval(id);
  }, [fetchPrice]);

  return { price, loading };
}

// ---- Status Badge ----
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    betting: { label: "BETTING OPEN", cls: "bg-[#00FF941A] border-[#00FF9440] text-[#00FF94]" },
    pending: { label: "PENDING RESOLUTION", cls: "bg-yellow-900/20 border-yellow-700/30 text-yellow-400" },
    reveal: { label: "REVEAL WINDOW", cls: "bg-purple-900/20 border-purple-700/30 text-purple-400" },
    resolved: { label: "RESOLVED", cls: "bg-gray-800 border-gray-700 text-gray-300" },
  };
  const s = map[status] ?? map.resolved;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold font-mono ${s.cls}`}>
      {status === "betting" && <span className="w-1.5 h-1.5 rounded-full bg-[#00FF94] animate-pulse" />}
      {s.label}
    </span>
  );
}

// ---- USDC Faucet (MockUSDC only) ----
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
        args: [address, parseUnits("10000", 6)], // 10,000 USDC
      });
      setStatus("done");
    } catch { setStatus("error"); }
  }

  if (status === "done") return <p className="text-xs text-[#00FF94] font-mono">+10,000 USDC minted!</p>;

  return (
    <button
      onClick={handleMint}
      disabled={status === "minting"}
      className="text-xs font-mono text-[#00FF94] border border-[#00FF9430] px-3 py-1 rounded hover:bg-[#00FF9410] transition-colors disabled:opacity-50"
    >
      {status === "minting" ? "Minting..." : "Get 10k USDC (testnet)"}
    </button>
  );
}

// ---- Resolve with Pyth button ----
function ResolveWithPythButton({ marketId, feedId, onResolved }: { marketId: number; feedId: string; onResolved: () => void }) {
  const [status, setStatus] = useState<"idle" | "fetching" | "resolving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  async function handleResolve() {
    setStatus("fetching");
    setMsg("Fetching live Pyth price...");
    try {
      // 1. Fetch fresh VAA from Hermes
      const res = await fetch(
        `${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}&encoding=hex`
      );
      const data = await res.json();
      const vaaHex = `0x${data.binary.data[0]}` as `0x${string}`;
      const livePrice = Number(data.parsed[0].price.price) * Math.pow(10, data.parsed[0].price.expo);
      const asset = feedInfo(feedId);
      setMsg(`${asset.symbol} at $${livePrice.toFixed(2)} — submitting to Pyth...`);

      // 2. Get update fee from Pyth contract
      const fee = await publicClient!.readContract({
        address: PYTH_ADDRESS,
        abi: PYTH_ABI,
        functionName: "getUpdateFee",
        args: [[vaaHex]],
      });

      setStatus("resolving");
      setMsg("Calling resolveWithPyth on-chain...");

      // 3. Call resolveWithPyth
      await writeContractAsync({
        address: SHADOW_ODDS_ADDRESS,
        abi: ShadowOddsABI,
        functionName: "resolveWithPyth",
        args: [BigInt(marketId), [vaaHex]],
        value: fee,
      });

      setStatus("done");
      setMsg(`Resolved! ${asset.symbol} was $${livePrice.toFixed(2)}`);
      setTimeout(onResolved, 1500);
    } catch (e: unknown) {
      setStatus("error");
      const err = e instanceof Error ? e.message : "Unknown error";
      setMsg(err.includes("User rejected") ? "Rejected" : err.slice(0, 100));
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-gray-400 text-sm">
        This market uses Pyth oracle. Anyone can trigger resolution by submitting the latest price proof on-chain.
      </p>
      <button
        onClick={handleResolve}
        disabled={status === "fetching" || status === "resolving"}
        className="w-full py-4 rounded-xl font-bold text-base text-black bg-[#00FF94] hover:bg-[#00e085] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        style={{ boxShadow: status === "idle" ? "0 0 20px #00FF9440" : "none" }}
      >
        {(status === "fetching" || status === "resolving") ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            {status === "fetching" ? "Fetching Pyth Price..." : "Resolving On-Chain..."}
          </span>
        ) : status === "done" ? (
          "Market Resolved!"
        ) : (
          "Resolve with Live Pyth Price"
        )}
      </button>
      {msg && (
        <p className={`text-xs font-mono ${status === "error" ? "text-red-400" : status === "done" ? "text-[#00FF94]" : "text-gray-500"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

// ---- Bet Form ----
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
      <div className="rounded-xl border border-[#00FF9440] bg-[#00FF9410] p-6 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-[#00FF94] font-bold text-lg mb-2">Bet Placed & Hidden!</p>
        <p className="text-gray-400 text-sm mb-4">
          Your {selectedOutcome === Outcome.YES ? "YES" : "NO"} position is hidden on-chain.
          Return after resolution to reveal and claim.
        </p>
        <div className="bg-[#0A0A0A] rounded-lg p-3 text-xs font-mono text-gray-500">
          Direction: <span className="bg-gray-800 px-2 py-0.5 rounded text-gray-600">████ hidden</span>
        </div>
      </div>
    );
  }

  const isBusy = step === "approving" || step === "betting";

  return (
    <div className="space-y-4">
      {/* USDC balance */}
      {address && usdcBalance !== undefined && (
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-gray-600">Your USDC balance</span>
          <div className="flex items-center gap-3">
            <span className="text-gray-400">{formatUSDC(usdcBalance as bigint)}</span>
            <USDCFaucet address={address} />
          </div>
        </div>
      )}

      {/* Outcome Selection */}
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider font-mono mb-2 block">Your Position</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setSelectedOutcome(Outcome.YES)}
            className={`py-4 rounded-xl border-2 font-bold text-lg transition-all ${
              selectedOutcome === Outcome.YES
                ? "border-green-500 bg-green-900/30 text-green-400"
                : "border-gray-800 bg-[#111] text-gray-500 hover:border-green-900 hover:text-green-600"
            }`}
          >
            YES
          </button>
          <button
            onClick={() => setSelectedOutcome(Outcome.NO)}
            className={`py-4 rounded-xl border-2 font-bold text-lg transition-all ${
              selectedOutcome === Outcome.NO
                ? "border-red-500 bg-red-900/30 text-red-400"
                : "border-gray-800 bg-[#111] text-gray-500 hover:border-red-900 hover:text-red-600"
            }`}
          >
            NO
          </button>
        </div>
      </div>

      {/* Amount */}
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider font-mono mb-2 block">Amount (USDC)</label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="1"
            className="w-full bg-[#111] border border-gray-800 rounded-xl px-4 py-3.5 text-white font-mono text-lg focus:outline-none focus:border-[#00FF9460] pr-20"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-mono text-sm">USDC</span>
        </div>
        <div className="flex gap-2 mt-2">
          {["10", "50", "100", "500"].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              className="px-2.5 py-1 rounded text-xs font-mono text-gray-500 border border-gray-800 hover:border-[#00FF9440] hover:text-[#00FF94] transition-colors"
            >
              ${v}
            </button>
          ))}
        </div>
      </div>

      {/* Privacy note */}
      {selectedOutcome !== null && amount && (
        <div className="rounded-lg border border-gray-800 bg-[#0D0D0D] p-3 text-xs space-y-1">
          <div className="flex justify-between text-gray-500">
            <span>On-chain visible:</span>
            <span className="font-mono text-white">${amount} USDC</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>On-chain hidden:</span>
            <span className="font-mono text-[#00FF94]">██ direction ██</span>
          </div>
        </div>
      )}

      {!address ? (
        <div className="text-center py-2">
          <p className="text-gray-500 text-sm mb-3">Connect wallet to bet</p>
          <ConnectButton />
        </div>
      ) : (
        <button
          onClick={handlePlaceBet}
          disabled={isBusy || !selectedOutcome || !amount || parseFloat(amount || "0") <= 0}
          className="w-full py-4 rounded-xl font-bold text-base text-black bg-[#00FF94] hover:bg-[#00e085] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          style={{ boxShadow: isBusy ? "none" : "0 0 20px #00FF9440" }}
        >
          {isBusy ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              {step === "approving" ? "Approving USDC..." : "Placing Hidden Bet..."}
            </span>
          ) : needsApproval ? "Approve & Place Hidden Bet" : "Place Hidden Bet"}
        </button>
      )}

      {step === "error" && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-400 font-mono">
          {errorMsg || "Transaction failed"}
        </div>
      )}
    </div>
  );
}

// ---- Reveal Form ----
function RevealForm({ market, marketId, onRevealed }: { market: Market; marketId: number; onRevealed: () => void }) {
  const { address } = useAccount();
  const [step, setStep] = useState<"idle" | "revealing" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const { writeContractAsync } = useWriteContract();
  const savedBet = address ? loadCommitment(marketId, address) : null;

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
      setErrorMsg(msg.includes("User rejected") ? "Transaction rejected" : msg.slice(0, 120));
      setStep("error");
    }
  }

  if (!savedBet) {
    return (
      <div className="rounded-xl border border-gray-800 bg-[#111] p-6 text-center">
        <p className="text-gray-500 text-sm">No saved bet found for this wallet.</p>
        <p className="text-gray-600 text-xs mt-2">Commitment data is stored in your browser localStorage.</p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="rounded-xl border border-purple-700/40 bg-purple-900/10 p-6 text-center">
        <div className="text-4xl mb-3">✅</div>
        <p className="text-purple-300 font-bold text-lg mb-2">Bet Revealed!</p>
        <p className="text-gray-400 text-sm">
          Your {outcomeLabel(savedBet.outcome)} position revealed. If you won, claim below.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800 bg-[#0D0D0D] p-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-500 font-mono">Your position</span>
          <span className={`text-sm font-bold px-2 py-0.5 rounded ${savedBet.outcome === Outcome.YES ? "text-green-400 bg-green-900/30" : "text-red-400 bg-red-900/30"}`}>
            {outcomeLabel(savedBet.outcome)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-gray-500 font-mono">Amount</span>
          <span className="text-sm font-mono text-white">{formatUSDC(savedBet.amount)}</span>
        </div>
      </div>

      {!address ? <ConnectButton /> : (
        <button
          onClick={handleReveal}
          disabled={step === "revealing"}
          className="w-full py-4 rounded-xl font-bold text-base text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-40 transition-all"
          style={{ boxShadow: step === "idle" ? "0 0 20px #7C3AED40" : "none" }}
        >
          {step === "revealing" ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Revealing...
            </span>
          ) : "Reveal My Bet"}
        </button>
      )}

      {step === "error" && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-400 font-mono">
          {errorMsg}
        </div>
      )}
    </div>
  );
}

// ---- Claim Form ----
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
      <div className="rounded-xl border border-[#00FF9440] bg-[#00FF9410] p-6 text-center">
        <div className="text-4xl mb-3">💰</div>
        <p className="text-[#00FF94] font-bold text-lg">Winnings Claimed!</p>
        <p className="text-gray-400 text-sm mt-2">USDC sent to your public wallet.</p>
        <div className="mt-4 pt-4 border-t border-[#00FF9430]">
          <p className="text-[#7C3AED] text-xs font-bold mb-1">Want full privacy?</p>
          <p className="text-gray-500 text-xs">
            Shield your winnings into your Unlink private account below — break the link between your win and your wallet.
          </p>
        </div>
      </div>
    );
  }
  if (claimed) return <div className="rounded-xl border border-gray-800 bg-[#111] p-6 text-center"><p className="text-gray-400">Already claimed.</p></div>;
  if (!revealed) return <div className="rounded-xl border border-yellow-800/40 bg-yellow-900/10 p-6 text-center"><p className="text-yellow-400 text-sm">Reveal your bet first.</p></div>;
  if (!isWinner) return <div className="rounded-xl border border-red-800/40 bg-red-900/10 p-6 text-center"><p className="text-red-400 text-sm">You bet {outcomeLabel(betOutcome!)} — market resolved {outcomeLabel(market.result)}. No winnings.</p></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#00FF9440] bg-[#00FF9410] p-4 text-center">
        <p className="text-xs text-gray-500 font-mono mb-1">You won!</p>
        <p className="text-2xl font-bold text-[#00FF94]">{outcomeLabel(betOutcome!)}</p>
        <p className="text-xs text-gray-500 mt-1">1% protocol fee on profits</p>
      </div>
      {!address ? <ConnectButton /> : (
        <button
          onClick={handleClaim}
          disabled={step === "claiming"}
          className="w-full py-4 rounded-xl font-bold text-base text-black bg-[#00FF94] hover:bg-[#00e085] disabled:opacity-40 transition-all"
          style={{ boxShadow: "0 0 20px #00FF9440" }}
        >
          {step === "claiming" ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Claiming...
            </span>
          ) : "Claim Winnings"}
        </button>
      )}
      {step === "error" && <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-400 font-mono">{errorMsg}</div>}
    </div>
  );
}

// ---- Privacy Panel ----
function PrivacyPanel({ market }: { market: Market }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-[#111] p-5">
      <h3 className="text-white font-bold mb-4 flex items-center gap-2 text-sm">
        <span className="text-[#00FF94]">🔒</span> What&apos;s Hidden?
      </h3>
      <div className="space-y-3">
        {[
          { dot: "red", label: "Amount locked", sub: "Visible — required for settlement" },
          { dot: "green", label: "YES/NO direction", sub: "Hidden via keccak256 commit-reveal" },
          { dot: "green", label: "Your secret key", sub: "Never leaves your browser" },
        ].map((item) => (
          <div key={item.label} className="flex items-start gap-3">
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${item.dot === "green" ? "bg-[#00FF94]" : "bg-red-400"}`} />
            <div>
              <p className="text-sm text-gray-300">{item.label}</p>
              <p className="text-xs text-gray-600">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Block explorer comparison */}
      <div className="mt-5 pt-5 border-t border-gray-800">
        <p className="text-xs text-gray-600 mb-3 font-mono uppercase tracking-wider">Block Explorer</p>
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3">
            <p className="text-red-400 font-bold mb-2">Polymarket</p>
            <p className="text-gray-500">bet(YES, $500)</p>
            <p className="text-gray-500">0xabc...</p>
            <p className="text-gray-700 text-[10px] mt-1">visible to all</p>
          </div>
          <div className="rounded-lg border border-[#00FF9430] bg-[#00FF9408] p-3">
            <p className="text-[#00FF94] font-bold mb-2">ShadowOdds</p>
            <p className="text-gray-300">bet($500)</p>
            <p className="text-gray-600">dir: <span className="bg-gray-800 px-1 rounded">███</span></p>
            <p className="text-gray-700 text-[10px] mt-1">direction hidden</p>
          </div>
        </div>
      </div>

      {/* Pool breakdown */}
      <div className="mt-4 pt-4 border-t border-gray-800">
        <h4 className="text-white font-bold mb-3 text-sm">Pool Breakdown</h4>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">YES pool</span>
            {market.resolved ? (
              <span className="font-mono text-green-400 text-sm">{formatUSDC(market.yesPool)}</span>
            ) : (
              <span className="text-gray-700 font-mono text-sm bg-gray-800 px-2 py-0.5 rounded">████████</span>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">NO pool</span>
            {market.resolved ? (
              <span className="font-mono text-red-400 text-sm">{formatUSDC(market.noPool)}</span>
            ) : (
              <span className="text-gray-700 font-mono text-sm bg-gray-800 px-2 py-0.5 rounded">████████</span>
            )}
          </div>
          <div className="flex justify-between items-center border-t border-gray-800 pt-2">
            <span className="text-sm text-gray-400 font-medium">Total</span>
            <span className="font-mono text-[#00FF94] font-bold text-sm">{formatUSDC(market.totalPool)}</span>
          </div>
        </div>
        {!market.resolved && (
          <p className="text-xs text-gray-700 font-mono mt-2">YES/NO split hidden until resolved</p>
        )}
      </div>
    </div>
  );
}

// ---- Main Market Page ----
export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const marketId = parseInt(id, 10);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, isLoading, isError, refetch } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "markets",
    args: [BigInt(marketId)],
    query: { refetchInterval: 4000 }, // auto-refresh every 4s
  });

  // Extract feedId from raw data before market is parsed (hooks must be unconditional)
  const rawFeedId = (data as unknown[])?.[6] as string ?? "";
  const { price: livePrice, loading: livePriceLoading } = useLivePrice(rawFeedId);
  const assetInfo = feedInfo(rawFeedId);

  const triggerRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <span className="w-5 h-5 border-2 border-[#00FF94] border-t-transparent rounded-full animate-spin" />
          Loading market...
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 text-lg mb-4">Market not found</p>
          <Link href="/" className="text-[#00FF94] hover:underline text-sm">← Back to markets</Link>
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
    <div className="min-h-screen bg-[#0A0A0A]">
      <header className="sticky top-0 z-50 border-b border-gray-900 bg-[#0A0A0A]/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-500 hover:text-white transition-colors flex items-center gap-2 text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Markets
            </Link>
            <span className="text-gray-800">/</span>
            <span className="text-gray-400 font-mono text-sm">#{marketId}</span>
          </div>
          <ConnectButton />
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left — Market info + action */}
          <div className="lg:col-span-2 space-y-6">
            {/* Question */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <StatusBadge status={status} />
                {isPriceFeed && (
                  <span className="text-xs font-mono text-[#7C3AED] px-2 py-0.5 rounded border border-[#7C3AED40] bg-[#7C3AED10]">
                    PYTH ORACLE
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white leading-snug">{market.question}</h1>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-gray-800 bg-[#111] p-4">
                <p className="text-xs text-gray-500 font-mono mb-1">Total Pool</p>
                <p className="text-[#00FF94] font-bold text-xl font-mono">{formatUSDC(market.totalPool)}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-[#111] p-4">
                <p className="text-xs text-gray-500 font-mono mb-1">
                  {status === "betting" ? "Closes In" : "Closed"}
                </p>
                <p className={`font-bold text-lg font-mono ${status === "betting" ? "text-white" : "text-gray-500"}`}>
                  {timeRemaining(market.bettingDeadline)}
                </p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-[#111] p-4">
                <p className="text-xs text-gray-500 font-mono mb-1">Reveal Window</p>
                <p className="font-bold text-lg font-mono text-white">{timeRemaining(market.revealDeadline)}</p>
              </div>
            </div>

            {/* Live ETH price for PRICE_FEED markets */}
            {isPriceFeed && (
              <div className="rounded-xl border border-[#7C3AED40] bg-[#7C3AED08] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 font-mono mb-1 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED] animate-pulse" />
                      Live {assetInfo.symbol}/USD (Pyth Hermes)
                    </p>
                    {livePriceLoading ? (
                      <div className="h-8 w-36 bg-gray-800 rounded animate-pulse" />
                    ) : (
                      <p className="text-2xl font-bold font-mono text-white">
                        ${livePrice?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}
                      </p>
                    )}
                    <p className="text-xs text-gray-600 mt-1">Updates every 400ms via Pyth</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 font-mono mb-1">Threshold (YES if above)</p>
                    <p className="text-xl font-bold font-mono text-[#7C3AED]">{thresholdUSD}</p>
                    {livePrice && (
                      <p className={`text-xs mt-1 font-mono font-bold ${livePrice >= Number(market.priceThreshold) / 1e8 ? "text-green-400" : "text-red-400"}`}>
                        {livePrice >= Number(market.priceThreshold) / 1e8 ? "✓ Would resolve YES" : "✗ Would resolve NO"}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Resolved result banner */}
            {market.resolved && (
              <div className={`rounded-xl border p-5 flex items-center gap-4 ${
                market.result === Outcome.YES ? "border-green-700/40 bg-green-900/10" : "border-red-700/40 bg-red-900/10"
              }`}>
                <span className="text-4xl">{market.result === Outcome.YES ? "✅" : "❌"}</span>
                <div>
                  <p className="text-sm text-gray-400">Market resolved</p>
                  <p className={`text-3xl font-black ${market.result === Outcome.YES ? "text-green-400" : "text-red-400"}`}>
                    {outcomeLabel(market.result)}
                  </p>
                  {isPriceFeed && livePrice && (
                    <p className="text-xs text-gray-500 mt-1">
                      {assetInfo.symbol} was ${livePrice.toFixed(2)} vs {thresholdUSD} threshold
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Action Panel */}
            <div className="rounded-xl border border-gray-800 bg-[#111] p-6">
              <h2 className="text-white font-bold text-base mb-5">
                {status === "betting" && "Place Your Hidden Bet"}
                {status === "pending" && (isPriceFeed ? "Resolve via Pyth Oracle" : "Waiting for Admin Resolution")}
                {status === "reveal" && "Reveal Your Bet"}
                {status === "resolved" && "Claim Your Winnings"}
              </h2>

              {status === "betting" && (
                <BetForm market={market} marketId={marketId} onBetPlaced={triggerRefresh} />
              )}

              {status === "pending" && isPriceFeed && (
                <ResolveWithPythButton key={refreshKey} marketId={marketId} feedId={market.priceFeedId} onResolved={triggerRefresh} />
              )}

              {status === "pending" && !isPriceFeed && (
                <div className="text-center py-8">
                  <div className="text-4xl mb-4">⏳</div>
                  <p className="text-gray-400 mb-2">Waiting for admin to resolve.</p>
                  <p className="text-gray-600 text-sm">
                    Resolution opens: {new Date(Number(market.resolutionTime) * 1000).toLocaleString()}
                  </p>
                </div>
              )}

              {status === "reveal" && (
                <RevealForm market={market} marketId={marketId} onRevealed={triggerRefresh} />
              )}

              {status === "resolved" && (
                <ClaimForm key={refreshKey} marketId={marketId} market={market} onClaimed={triggerRefresh} />
              )}
            </div>

            {/* Market details */}
            <div className="rounded-xl border border-gray-800 bg-[#111] p-5">
              <h3 className="text-white font-bold mb-4 text-sm">Market Details</h3>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                {[
                  { label: "Oracle", value: isPriceFeed ? "Pyth (trustless)" : "Admin key" },
                  { label: "Settlement", value: "USDC (6 decimals)" },
                  { label: "Privacy", value: "keccak256 commit-reveal" },
                  { label: "Network", value: "Monad testnet (10143)" },
                  { label: "Contract", value: `${SHADOW_ODDS_ADDRESS?.slice(0, 10)}...` },
                  { label: "Protocol fee", value: "1% on profits" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center py-1.5 border-b border-gray-900">
                    <span className="text-gray-500">{label}</span>
                    <span className="text-gray-300">{value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <a
                  href={`https://testnet.monadexplorer.com/address/${SHADOW_ODDS_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#00FF94] hover:underline font-mono"
                >
                  View on Monad Explorer →
                </a>
              </div>
            </div>
          </div>

          {/* Right — Privacy Score + Shadow Receipt + Privacy Panel + Unlink Wallet */}
          <div className="space-y-6">
            <PrivacyScore marketId={marketId} />
            <ShadowReceipt marketId={marketId} market={market} />
            <PrivacyPanel market={market} />
            <UnlinkWallet />
          </div>
        </div>
      </div>
    </div>
  );
}
