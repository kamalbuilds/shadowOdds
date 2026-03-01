"use client";

import { useState, useEffect } from "react";
import { useBurner, useUnlinkBalance } from "@unlink-xyz/react";
import { useAccount, useSendTransaction } from "wagmi";
import { formatUnits, parseUnits, encodeFunctionData, parseAbi, parseEther } from "viem";
import { USDC_ADDRESS, SHADOW_ODDS_ADDRESS } from "@/lib/wagmi";
import { Outcome, createCommitment, saveCommitment, loadCommitment, outcomeLabel } from "@/lib/shadowodds";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const SHADOW_ABI = parseAbi([
  "function placeBet(uint256 marketId, bytes32 commitment, uint256 amount)",
  "function revealBet(uint256 marketId, bytes32 secret, uint8 outcome, uint256 amount, uint256 nonce)",
  "function claimWinnings(uint256 marketId)",
]);

type Step = "idle" | "creating" | "funding" | "funding-gas" | "approving" | "betting" | "revealing" | "claiming" | "sweeping" | "done" | "error";

interface AnonymousBetProps {
  marketId: number;
  bettingOpen: boolean;
  marketResolved?: boolean;
  marketResult?: Outcome;
}

export function PrivateAdapter({ marketId, bettingOpen, marketResolved, marketResult }: AnonymousBetProps) {
  const { address } = useAccount();
  const {
    burners,
    createBurner,
    fund: burnerFund,
    send: burnerSend,
    sweepToPool: burnerSweep,
    getTokenBalance,
    getBalance,
  } = useBurner();
  const { sendTransactionAsync } = useSendTransaction();
  const { balance: privateBalance } = useUnlinkBalance(USDC_ADDRESS);

  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState<Outcome | null>(null);
  const [burnerUsdcBalance, setBurnerUsdcBalance] = useState<string | null>(null);
  const [burnerGasBalance, setBurnerGasBalance] = useState<bigint | null>(null);
  const [betPlaced, setBetPlaced] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const burnerIdx = 0;
  const activeBurner = burners[burnerIdx];

  // Check if there's a saved burner commitment for this market
  const savedBet = activeBurner ? loadCommitment(marketId, activeBurner.address) : null;

  // Auto-detect if we have an existing bet on mount
  useEffect(() => {
    if (savedBet && activeBurner) {
      setBetPlaced(true);
      setSelectedOutcome(savedBet.outcome);
    }
  }, [!!savedBet, !!activeBurner]);

  const fmtPrivate = privateBalance !== undefined
    ? formatUnits(privateBalance, 6)
    : "0";

  function parseError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("User rejected")) return "Transaction rejected";
    if (msg.includes("insufficient balance") || msg.includes("Insufficient"))
      return "Burner needs gas (MON). Will auto-fund on next attempt.";
    if (msg.includes("already revealed")) return "Bet already revealed.";
    if (msg.includes("already claimed")) return "Winnings already claimed.";
    if (msg.includes("404") || msg.includes("server response"))
      return "Unlink relay unavailable. Try again shortly.";
    return msg.slice(0, 150);
  }

  async function ensureGas() {
    if (!activeBurner) return;
    const GAS_THRESHOLD = parseEther("0.01");
    const GAS_AMOUNT = parseEther("0.05");
    const nativeBal = await getBalance(activeBurner.address);
    if (nativeBal < GAS_THRESHOLD) {
      setStep("funding-gas");
      await sendTransactionAsync({
        to: activeBurner.address as `0x${string}`,
        value: GAS_AMOUNT,
      });
      setBurnerGasBalance(GAS_AMOUNT);
    }
  }

  async function refreshBurnerBalance() {
    if (!activeBurner) return;
    try {
      const bal = await getTokenBalance(activeBurner.address, USDC_ADDRESS);
      setBurnerUsdcBalance(formatUnits(bal, 6));
    } catch { setBurnerUsdcBalance("0"); }
    try {
      const gas = await getBalance(activeBurner.address);
      setBurnerGasBalance(gas);
    } catch { setBurnerGasBalance(0n); }
  }

  async function handleCreateBurner() {
    setErrorMsg("");
    setStep("creating");
    try {
      await createBurner(burnerIdx);
      setStep("idle");
    } catch (e) {
      setStep("error");
      setErrorMsg(parseError(e));
    }
  }

  async function handleFundBurner() {
    if (!amount || parseFloat(amount) <= 0) return;
    setErrorMsg("");
    setStep("funding");
    try {
      await burnerFund.execute({
        index: burnerIdx,
        params: { token: USDC_ADDRESS, amount: parseUnits(amount, 6) },
      });
      await refreshBurnerBalance();
      setStep("idle");
    } catch (e) {
      setStep("error");
      setErrorMsg(parseError(e));
    }
  }

  async function handlePlaceBet() {
    if (!activeBurner || !amount || selectedOutcome === null) return;
    setErrorMsg("");

    const amountBigInt = parseUnits(amount, 6);
    const bet = createCommitment(selectedOutcome, amount);

    try {
      await ensureGas();

      // Approve
      setStep("approving");
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [SHADOW_ODDS_ADDRESS, amountBigInt],
      });
      await burnerSend.execute({
        index: burnerIdx,
        tx: { to: USDC_ADDRESS, data: approveData },
      });

      // Place bet
      setStep("betting");
      const betData = encodeFunctionData({
        abi: SHADOW_ABI,
        functionName: "placeBet",
        args: [BigInt(marketId), bet.commitment, amountBigInt],
      });
      await burnerSend.execute({
        index: burnerIdx,
        tx: { to: SHADOW_ODDS_ADDRESS, data: betData },
      });

      saveCommitment(marketId, activeBurner.address as `0x${string}`, bet);
      setBetPlaced(true);
      await refreshBurnerBalance();
      setStep("done");
    } catch (e) {
      setStep("error");
      setErrorMsg(parseError(e));
    }
  }

  async function handleReveal() {
    if (!activeBurner || !savedBet) return;
    setErrorMsg("");

    try {
      await ensureGas();

      setStep("revealing");
      const revealData = encodeFunctionData({
        abi: SHADOW_ABI,
        functionName: "revealBet",
        args: [
          BigInt(marketId),
          savedBet.secret,
          savedBet.outcome,
          savedBet.amount,
          savedBet.nonce,
        ],
      });
      await burnerSend.execute({
        index: burnerIdx,
        tx: { to: SHADOW_ODDS_ADDRESS, data: revealData },
      });

      setRevealed(true);
      setStep("idle");
    } catch (e) {
      setStep("error");
      setErrorMsg(parseError(e));
    }
  }

  async function handleClaim() {
    if (!activeBurner) return;
    setErrorMsg("");

    try {
      await ensureGas();

      setStep("claiming");
      const claimData = encodeFunctionData({
        abi: SHADOW_ABI,
        functionName: "claimWinnings",
        args: [BigInt(marketId)],
      });
      await burnerSend.execute({
        index: burnerIdx,
        tx: { to: SHADOW_ODDS_ADDRESS, data: claimData },
      });

      setClaimed(true);
      await refreshBurnerBalance();
      setStep("idle");
    } catch (e) {
      setStep("error");
      setErrorMsg(parseError(e));
    }
  }

  async function handleSweep() {
    setErrorMsg("");
    setStep("sweeping");
    try {
      await burnerSweep.execute({
        index: burnerIdx,
        params: { token: USDC_ADDRESS },
      });
      setBurnerUsdcBalance("0");
      setStep("idle");
    } catch (e) {
      setStep("error");
      setErrorMsg(parseError(e));
    }
  }

  if (!address) return null;

  const isBusy = step !== "idle" && step !== "done" && step !== "error";
  const canReveal = marketResolved && savedBet && !revealed;
  const isWinner = marketResult !== undefined && savedBet && savedBet.outcome === marketResult;
  const canClaim = revealed && isWinner && !claimed;
  const hasBurnerFunds = burnerUsdcBalance && parseFloat(burnerUsdcBalance) > 0;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-white font-semibold text-sm">Bet Anonymously</h3>
        <span className="text-[11px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
          Burner
        </span>
      </div>

      <p className="text-xs text-zinc-500 leading-relaxed">
        Place a bet from a burner wallet funded by your shielded pool.
        No link between your identity and this bet.
      </p>

      {/* Step 1: Create burner if needed */}
      {!activeBurner ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-zinc-950 p-3">
            <p className="text-xs text-zinc-400 mb-2">How it works:</p>
            <div className="space-y-1.5">
              {["Create anonymous burner wallet", "Fund it from your shielded pool", "Place bet — no identity link", "Reveal & claim from burner", "Sweep winnings back to pool"].map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] text-amber-400 font-mono w-4">{i + 1}.</span>
                  <span className="text-[11px] text-zinc-500">{s}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={handleCreateBurner}
            disabled={step === "creating"}
            className="w-full py-2.5 rounded-lg font-medium text-xs text-black bg-amber-400 hover:bg-amber-500 disabled:opacity-40 transition-colors"
          >
            {step === "creating" ? "Creating..." : "Create Burner Wallet"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Burner info */}
          <div className="rounded-lg bg-zinc-950 p-3 text-xs font-mono space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-zinc-600">Burner</span>
              <span className="text-amber-400 text-[11px]">anonymous</span>
            </div>
            <p className="text-zinc-500 break-all text-[11px]">{activeBurner.address}</p>
            <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/60">
              <span className="text-zinc-600">USDC</span>
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">{burnerUsdcBalance ?? "—"}</span>
                <button onClick={refreshBurnerBalance} className="text-[11px] text-zinc-600 hover:text-amber-400 transition-colors">
                  refresh
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-600">Gas (MON)</span>
              <span className={`font-medium ${burnerGasBalance !== null && burnerGasBalance > 0n ? "text-[#00e87b]" : "text-red-400"}`}>
                {burnerGasBalance !== null ? parseFloat(formatUnits(burnerGasBalance, 18)).toFixed(4) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-600">Shielded</span>
              <span className="text-[#836EF9] font-medium">{fmtPrivate} USDC</span>
            </div>
          </div>

          {/* Post-bet lifecycle: Reveal → Claim → Sweep */}
          {betPlaced && savedBet ? (
            <div className="space-y-3">
              {/* Status banner */}
              <div className={`rounded-lg border p-3 text-center ${
                claimed ? "border-[#836EF9]/20 bg-[#836EF9]/5" :
                revealed ? "border-[#00e87b]/20 bg-[#00e87b]/5" :
                "border-amber-500/20 bg-amber-500/5"
              }`}>
                <p className={`text-xs font-medium ${
                  claimed ? "text-[#836EF9]" : revealed ? "text-[#00e87b]" : "text-amber-400"
                }`}>
                  {claimed ? "Winnings claimed" :
                   revealed ? "Bet revealed — awaiting claim" :
                   "Anonymous bet placed"}
                </p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  {outcomeLabel(savedBet.outcome)} — {formatUnits(savedBet.amount, 6)} USDC
                  {!revealed && " — direction hidden on-chain"}
                </p>
              </div>

              {/* Reveal button (after market resolves, before reveal) */}
              {canReveal && (
                <button
                  onClick={handleReveal}
                  disabled={isBusy}
                  className="w-full py-2.5 rounded-lg font-medium text-xs text-black bg-amber-400 hover:bg-amber-500 disabled:opacity-40 transition-colors"
                >
                  {step === "funding-gas" ? "Funding gas..." :
                   step === "revealing" ? "Revealing from burner..." :
                   `Reveal ${outcomeLabel(savedBet.outcome)} Bet (from burner)`}
                </button>
              )}

              {/* Claim button (after reveal, if winner) */}
              {canClaim && (
                <button
                  onClick={handleClaim}
                  disabled={isBusy}
                  className="w-full py-2.5 rounded-lg font-medium text-xs text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors"
                >
                  {step === "funding-gas" ? "Funding gas..." :
                   step === "claiming" ? "Claiming from burner..." :
                   "Claim Winnings (from burner)"}
                </button>
              )}

              {/* Lost message */}
              {revealed && marketResult !== undefined && !isWinner && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-center">
                  <p className="text-red-400 text-xs font-medium">Bet lost</p>
                  <p className="text-[11px] text-zinc-500 mt-1">Market resolved {outcomeLabel(marketResult)}</p>
                </div>
              )}

              {/* Sweep back to privacy pool */}
              {hasBurnerFunds && (claimed || (revealed && !isWinner)) && (
                <button
                  onClick={handleSweep}
                  disabled={step === "sweeping" || burnerSweep.isPending}
                  className="w-full py-2 rounded-lg text-xs font-medium text-[#836EF9] border border-[#836EF9]/30 hover:bg-[#836EF9]/10 disabled:opacity-40 transition-colors"
                >
                  {step === "sweeping" || burnerSweep.isPending ? "Sweeping..." : "Sweep Winnings to Privacy Pool"}
                </button>
              )}

              {/* Place another bet */}
              {!canReveal && !canClaim && (
                <button
                  onClick={() => { setBetPlaced(false); setStep("idle"); setAmount(""); setSelectedOutcome(null); setRevealed(false); setClaimed(false); }}
                  className="w-full text-xs text-zinc-500 hover:text-white transition-colors"
                >
                  Place another bet
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Betting UI */}
              {(!burnerUsdcBalance || parseFloat(burnerUsdcBalance) === 0) && !bettingOpen ? (
                <p className="text-xs text-zinc-500 text-center py-2">Betting is closed for this market.</p>
              ) : (
                <div className="space-y-3">
                  {bettingOpen && (
                    <>
                      <div>
                        <label className="text-xs text-zinc-500 mb-2 block">Direction (hidden on-chain)</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setSelectedOutcome(Outcome.YES)}
                            className={`py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
                              selectedOutcome === Outcome.YES
                                ? "border-green-500/60 bg-green-500/10 text-green-400"
                                : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
                            }`}
                          >
                            YES
                          </button>
                          <button
                            onClick={() => setSelectedOutcome(Outcome.NO)}
                            className={`py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
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
                        <label className="text-xs text-zinc-500 mb-1.5 block">Amount (USDC)</label>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-amber-400"
                        />
                        <div className="flex gap-1.5 mt-1.5">
                          {["10", "50", "100"].map((v) => (
                            <button
                              key={v}
                              onClick={() => setAmount(v)}
                              className="px-2 py-0.5 rounded text-[11px] text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
                            >
                              ${v}
                            </button>
                          ))}
                        </div>
                      </div>

                      {selectedOutcome !== null && amount && parseFloat(amount) > 0 && (
                        <div className="space-y-2">
                          {(!burnerUsdcBalance || parseFloat(burnerUsdcBalance) < parseFloat(amount)) && (
                            <button
                              onClick={handleFundBurner}
                              disabled={step === "funding" || burnerFund.isPending || privateBalance === 0n}
                              className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-[#836EF9] hover:bg-[#7360e0] disabled:opacity-40 transition-colors"
                            >
                              {step === "funding" || burnerFund.isPending
                                ? "Funding burner..."
                                : `Fund ${amount} USDC from Shielded Pool`}
                            </button>
                          )}

                          {burnerUsdcBalance && parseFloat(burnerUsdcBalance) >= parseFloat(amount) && (
                            <button
                              onClick={handlePlaceBet}
                              disabled={isBusy}
                              className="w-full py-2.5 rounded-lg font-medium text-xs text-black bg-amber-400 hover:bg-amber-500 disabled:opacity-40 transition-colors"
                            >
                              {step === "funding-gas" ? "Funding gas..." :
                               step === "approving" ? "Approving..." :
                               step === "betting" || burnerSend.isPending ? "Placing bet..." :
                               `Bet ${outcomeLabel(selectedOutcome)} — ${amount} USDC`}
                            </button>
                          )}

                          <div className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-2.5 text-[11px] space-y-1">
                            <div className="flex justify-between text-zinc-500">
                              <span>Source</span>
                              <span className="text-[#836EF9]">Shielded pool</span>
                            </div>
                            <div className="flex justify-between text-zinc-500">
                              <span>Bettor address</span>
                              <span className="text-amber-400">Burner (anonymous)</span>
                            </div>
                            <div className="flex justify-between text-zinc-500">
                              <span>Direction visible?</span>
                              <span className="text-[#00e87b]">Hidden (commit-reveal)</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {hasBurnerFunds && !bettingOpen && (
                    <button
                      onClick={handleSweep}
                      disabled={step === "sweeping" || burnerSweep.isPending}
                      className="w-full py-2 rounded-lg text-xs font-medium text-[#836EF9] border border-[#836EF9]/30 hover:bg-[#836EF9]/10 disabled:opacity-40 transition-colors"
                    >
                      {step === "sweeping" ? "Sweeping..." : "Sweep to Privacy Pool"}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {errorMsg && <p className="text-xs text-red-400 mt-2">{errorMsg}</p>}
    </div>
  );
}
