"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { parseUnits, parseAbi, encodeFunctionData } from "viem";
import { useInteract } from "@unlink-xyz/react";
import {
  Outcome,
  createLimitOrderCommitment,
  saveLimitOrder,
  type TriggerDirection,
} from "@/lib/shadowodds";
import { SHADOW_LIMIT_ORDER_ADDRESS, USDC_ADDRESS, feedInfo } from "@/lib/wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import ShadowLimitOrderABI from "@/lib/ShadowLimitOrderABI.json";

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

interface LimitOrderFormProps {
  marketId: number;
  feedId: string;
  bettingOpen: boolean;
}

export function LimitOrderForm({ marketId, feedId, bettingOpen }: LimitOrderFormProps) {
  const { address } = useAccount();
  const [triggerPrice, setTriggerPrice] = useState("");
  const [direction, setDirection] = useState<TriggerDirection>("ABOVE_OR_EQUAL");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [amount, setAmount] = useState("");
  const [expiry, setExpiry] = useState("24");
  const [privacyMode, setPrivacyMode] = useState(true);
  const [step, setStep] = useState<"idle" | "approving" | "creating" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const asset = feedInfo(feedId);
  const amountBigInt = amount ? parseUnits(amount, 6) : 0n;
  const keeperRewardBps = 50; // 0.5%
  const { interact } = useInteract();

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, SHADOW_LIMIT_ORDER_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const { writeContractAsync } = useWriteContract();
  const needsApproval = allowance !== undefined && amountBigInt > 0n && (allowance as bigint) < amountBigInt;

  async function handleCreate() {
    if (!address || outcome === null || !amount || !triggerPrice) return;
    setErrorMsg("");

    try {
      // Pyth price format: price * 10^8
      const triggerPriceRaw = BigInt(Math.round(parseFloat(triggerPrice) * 1e8));
      const expiryTimestamp = Math.floor(Date.now() / 1000) + parseInt(expiry) * 3600;

      // Generate commitments
      const commits = createLimitOrderCommitment(
        marketId,
        triggerPriceRaw,
        direction,
        outcome,
        amount,
        keeperRewardBps,
      );

      const orderArgs = [
        commits.orderCommitment,
        commits.betCommitment,
        feedId as `0x${string}`,
        BigInt(marketId),
        amountBigInt,
        BigInt(expiryTimestamp),
        BigInt(keeperRewardBps),
      ] as const;

      if (privacyMode) {
        // Private flow via useInteract
        setStep("creating");
        const approveCalldata = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [SHADOW_LIMIT_ORDER_ADDRESS, amountBigInt],
        });
        const createOrderCalldata = encodeFunctionData({
          abi: ShadowLimitOrderABI,
          functionName: "createOrder",
          args: [...orderArgs],
        });
        await interact({
          spend: [{ token: USDC_ADDRESS, amount: amountBigInt + 1n }],
          calls: [
            { to: USDC_ADDRESS, data: approveCalldata, value: 0n },
            { to: SHADOW_LIMIT_ORDER_ADDRESS, data: createOrderCalldata, value: 0n },
          ],
          receive: [{ token: USDC_ADDRESS, minAmount: 0n }],
        });
      } else {
        // Direct flow
        if (needsApproval) {
          setStep("approving");
          await writeContractAsync({
            address: USDC_ADDRESS,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [SHADOW_LIMIT_ORDER_ADDRESS, amountBigInt],
          });
          await refetchAllowance();
        }

        setStep("creating");
        await writeContractAsync({
          address: SHADOW_LIMIT_ORDER_ADDRESS,
          abi: ShadowLimitOrderABI,
          functionName: "createOrder",
          args: [...orderArgs],
        });
      }

      // Save to localStorage
      const orderId = Date.now(); // placeholder — real ID comes from event
      saveLimitOrder(address, {
        orderId,
        marketId,
        triggerPrice: triggerPriceRaw.toString(),
        triggerDir: direction,
        betOutcome: outcome,
        amount: amountBigInt.toString(),
        keeperRewardBps,
        orderSecret: commits.orderSecret,
        orderNonce: commits.orderNonce.toString(),
        betSecret: commits.betSecret,
        betNonce: commits.betNonce.toString(),
        expiry: expiryTimestamp,
        createdAt: Math.floor(Date.now() / 1000),
      });

      setStep("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setErrorMsg(msg.includes("User rejected") ? "Transaction rejected" : msg.slice(0, 120));
      setStep("error");
    }
  }

  if (!SHADOW_LIMIT_ORDER_ADDRESS) {
    return <p className="text-zinc-500 text-sm text-center py-4">Limit orders not configured.</p>;
  }

  if (!bettingOpen) {
    return <p className="text-zinc-500 text-sm text-center py-4">Betting is closed for this market.</p>;
  }

  if (step === "done") {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-5 text-center">
        <p className="text-[#00e87b] font-semibold mb-1">Limit order placed{privacyMode ? " privately" : ""}</p>
        <p className="text-zinc-400 text-sm mb-2">
          Auto-executes when {asset.symbol} is {direction === "ABOVE_OR_EQUAL" ? "above" : "below"} ${triggerPrice}.
        </p>
        <p className="text-xs text-zinc-600">
          Trigger condition is hidden on-chain via commitment.
        </p>
        {privacyMode && (
          <p className="text-xs text-[#836EF9] mt-1">Placed via Unlink — no wallet link.</p>
        )}
      </div>
    );
  }

  const isBusy = step === "approving" || step === "creating";

  return (
    <div className="space-y-4">
      {/* Privacy toggle */}
      <div className="flex items-center gap-1 p-0.5 bg-zinc-950 rounded-lg border border-zinc-800/40">
        <button
          onClick={() => setPrivacyMode(true)}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
            privacyMode ? "bg-[#836EF9]/20 text-[#836EF9] border border-[#836EF9]/30" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          Private
        </button>
        <button
          onClick={() => setPrivacyMode(false)}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
            !privacyMode ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Direct
        </button>
      </div>

      {/* Trigger price */}
      <div>
        <label className="text-xs text-zinc-500 mb-2 block">Trigger price ({asset.symbol}/USD)</label>
        <input
          type="number"
          value={triggerPrice}
          onChange={(e) => setTriggerPrice(e.target.value)}
          placeholder="e.g. 2500.00"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-zinc-600"
        />
      </div>

      {/* Direction */}
      <div>
        <label className="text-xs text-zinc-500 mb-2 block">Trigger when price is</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setDirection("ABOVE_OR_EQUAL")}
            className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              direction === "ABOVE_OR_EQUAL"
                ? "border-[#00e87b]/40 bg-[#00e87b]/10 text-[#00e87b]"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
            }`}
          >
            Above / Equal
          </button>
          <button
            onClick={() => setDirection("BELOW")}
            className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              direction === "BELOW"
                ? "border-red-500/40 bg-red-500/10 text-red-400"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
            }`}
          >
            Below
          </button>
        </div>
      </div>

      {/* Bet outcome */}
      <div>
        <label className="text-xs text-zinc-500 mb-2 block">Bet position</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setOutcome(Outcome.YES)}
            className={`py-3 rounded-lg border font-semibold transition-colors ${
              outcome === Outcome.YES
                ? "border-green-500/60 bg-green-500/10 text-green-400"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
            }`}
          >
            YES
          </button>
          <button
            onClick={() => setOutcome(Outcome.NO)}
            className={`py-3 rounded-lg border font-semibold transition-colors ${
              outcome === Outcome.NO
                ? "border-red-500/60 bg-red-500/10 text-red-400"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
            }`}
          >
            NO
          </button>
        </div>
      </div>

      {/* Amount */}
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

      {/* Expiry */}
      <div>
        <label className="text-xs text-zinc-500 mb-2 block">Order expires in</label>
        <div className="flex gap-1.5">
          {[
            { label: "1h", value: "1" },
            { label: "6h", value: "6" },
            { label: "24h", value: "24" },
            { label: "48h", value: "48" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setExpiry(opt.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                expiry === opt.value
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-500 border border-zinc-800 hover:border-zinc-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Privacy info */}
      {triggerPrice && outcome !== null && amount && (
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-3 text-sm space-y-1">
          {privacyMode && (
            <div className="flex justify-between text-zinc-500">
              <span>Source</span>
              <span className="text-[#836EF9] font-mono">Shielded pool</span>
            </div>
          )}
          <div className="flex justify-between text-zinc-500">
            <span>Visible on-chain</span>
            <span className="text-white font-mono">${amount} escrowed</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Hidden on-chain</span>
            <span className="text-[#00e87b] font-mono">trigger, direction, outcome</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Keeper reward</span>
            <span className="text-zinc-400 font-mono">0.5%</span>
          </div>
        </div>
      )}

      {/* Submit */}
      {!address ? (
        <div className="text-center py-2">
          <ConnectButton />
        </div>
      ) : (
        <button
          onClick={handleCreate}
          disabled={isBusy || outcome === null || !amount || !triggerPrice || parseFloat(amount || "0") <= 0}
          className={`w-full py-3.5 rounded-lg font-semibold text-sm disabled:opacity-40 transition-colors ${
            privacyMode
              ? "text-white bg-[#836EF9] hover:bg-[#7360e0]"
              : "text-black bg-[#00e87b] hover:bg-[#00d46f]"
          }`}
        >
          {isBusy
            ? (step === "approving" ? "Approving..." : "Creating order...")
            : privacyMode
              ? "Place Private Limit Order"
              : needsApproval ? "Approve & Create Order" : "Place Limit Order"}
        </button>
      )}

      {step === "error" && (
        <p className="text-xs text-red-400">{errorMsg || "Transaction failed"}</p>
      )}
    </div>
  );
}
