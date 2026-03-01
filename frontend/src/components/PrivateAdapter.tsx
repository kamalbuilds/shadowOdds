"use client";

import { useState } from "react";
import { useAdapter, useUnlinkBalance } from "@unlink-xyz/react";
import { useAccount } from "wagmi";
import { formatUnits, parseUnits, encodeFunctionData, parseAbi } from "viem";
import { USDC_ADDRESS, SHADOW_ODDS_ADDRESS } from "@/lib/wagmi";

const SHADOW_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

interface PrivateAdapterProps {
  adapterAddress?: `0x${string}`;
}

/**
 * PrivateAdapter — Atomic private DeFi operations via Unlink's adapter pattern.
 *
 * Flow: Unshield USDC from privacy pool → Execute DeFi call → Reshield output
 * All in one atomic transaction with zero public trace from user to action.
 *
 * This uses Unlink's useAdapter() hook — the most powerful SDK feature.
 * It enables private interaction with ANY DeFi protocol without revealing the user.
 */
export function PrivateAdapter({ adapterAddress }: PrivateAdapterProps) {
  const { address } = useAccount();
  const { execute: executeAdapter, isPending, error: adapterError } = useAdapter();
  const { balance: privateBalance } = useUnlinkBalance(USDC_ADDRESS);

  const [amount, setAmount] = useState("");
  const [targetContract, setTargetContract] = useState<string>(SHADOW_ODDS_ADDRESS || "");
  const [callData, setCallData] = useState("");
  const [step, setStep] = useState<"idle" | "executing" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [resultData, setResultData] = useState<string | null>(null);

  const fmtBalance = privateBalance !== undefined
    ? formatUnits(privateBalance, 6)
    : "...";

  async function handleExecute() {
    if (!amount || !adapterAddress) return;
    setErrorMsg("");
    setStep("executing");

    try {
      const amountBigInt = parseUnits(amount, 6);

      // Build the approve calldata for the target contract
      const approveData = encodeFunctionData({
        abi: SHADOW_ABI,
        functionName: "approve",
        args: [targetContract as `0x${string}`, amountBigInt],
      });

      const result = await executeAdapter({
        adapterAddress,
        inputs: [{ token: USDC_ADDRESS, amount: amountBigInt }],
        calls: [
          // First approve the target contract to spend USDC
          { to: USDC_ADDRESS, data: approveData, value: 0n },
          // Then execute the actual DeFi call
          ...(callData ? [{ to: targetContract, data: callData, value: 0n }] : []),
        ],
        reshields: [{ token: USDC_ADDRESS, minAmount: 0n }],
      });

      setResultData(JSON.stringify(result, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
      setStep("done");
      setAmount("");
    } catch (e) {
      setStep("error");
      setErrorMsg(e instanceof Error ? e.message.slice(0, 150) : "Adapter execution failed");
    }
  }

  if (!address) return null;

  return (
    <div className="rounded-xl border border-[#00FF9430] bg-[#00FF9408] p-5 space-y-4">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-[#00FF94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <h3 className="text-white font-bold text-sm">Private DeFi Adapter</h3>
        <span className="text-[9px] font-mono text-[#00FF94] bg-[#00FF9415] px-1.5 py-0.5 rounded border border-[#00FF9430]">
          ATOMIC ZK
        </span>
      </div>

      <div className="rounded-lg border border-[#00FF9420] bg-[#00FF9408] p-3">
        <p className="text-[10px] text-gray-500 font-mono leading-relaxed">
          Atomic flow: <span className="text-[#00FF94]">Unshield USDC</span> → <span className="text-white">Execute DeFi calls</span> → <span className="text-[#7C3AED]">Reshield output</span>
          <br />All in one transaction. Zero public trace from your identity to the DeFi action.
        </p>
      </div>

      {!adapterAddress ? (
        <div className="rounded-lg bg-[#0A0A0A] p-4 text-center">
          <p className="text-gray-500 text-xs font-mono">Adapter contract not configured.</p>
          <p className="text-gray-600 text-[10px] mt-1">
            Deploy an Unlink adapter contract to enable atomic private DeFi operations.
          </p>
        </div>
      ) : (
        <>
          {step === "done" ? (
            <div className="rounded-lg border border-[#00FF9440] bg-[#00FF9410] p-3 text-center space-y-2">
              <p className="text-[#00FF94] text-xs font-bold">Adapter execution complete!</p>
              <p className="text-[10px] text-gray-500 font-mono">Private DeFi call executed atomically. No on-chain link to your identity.</p>
              {resultData && (
                <pre className="text-[9px] font-mono text-gray-600 text-left bg-[#0A0A0A] p-2 rounded max-h-24 overflow-auto">
                  {resultData}
                </pre>
              )}
              <button onClick={() => { setStep("idle"); setResultData(null); }} className="text-xs text-gray-500 hover:text-white">
                Execute again
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs text-gray-500 font-mono">Amount (USDC from shielded pool)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#00FF94]"
                  />
                  <button
                    onClick={handleExecute}
                    disabled={isPending || step === "executing" || !amount}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-black bg-[#00FF94] hover:bg-[#00cc77] disabled:opacity-40 transition-all whitespace-nowrap"
                  >
                    {step === "executing" || isPending ? "Executing..." : "Execute Private"}
                  </button>
                </div>
                {privateBalance !== undefined && (
                  <button
                    onClick={() => setAmount(fmtBalance)}
                    className="text-[10px] text-gray-600 hover:text-[#00FF94] font-mono"
                  >
                    Use all ({fmtBalance} USDC)
                  </button>
                )}
              </div>

              {/* Advanced: target contract + calldata */}
              <details className="group">
                <summary className="text-[10px] text-gray-600 font-mono cursor-pointer hover:text-gray-400">
                  Advanced: Custom DeFi target
                </summary>
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={targetContract}
                    onChange={(e) => setTargetContract(e.target.value)}
                    placeholder="0x... target contract"
                    className="w-full bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white text-[10px] font-mono focus:outline-none focus:border-[#00FF94]"
                  />
                  <input
                    type="text"
                    value={callData}
                    onChange={(e) => setCallData(e.target.value)}
                    placeholder="0x... calldata"
                    className="w-full bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white text-[10px] font-mono focus:outline-none focus:border-[#00FF94]"
                  />
                </div>
              </details>
            </div>
          )}

          {(step === "error" || adapterError) && (
            <p className="text-xs text-red-400 font-mono">{errorMsg || adapterError?.message}</p>
          )}
        </>
      )}

      {/* How it works */}
      <div className="rounded-lg bg-[#0A0A0A] p-3 text-[9px] font-mono text-gray-600 space-y-1">
        <p className="text-gray-500 font-bold mb-1">HOW ADAPTER WORKS:</p>
        <p>1. USDC unshielded from your private pool (ZK proof)</p>
        <p>2. DeFi calls executed atomically (approve + action)</p>
        <p>3. Remaining tokens reshielded back to pool</p>
        <p className="text-[#00FF94] mt-1">Result: DeFi interaction with zero identity exposure</p>
      </div>
    </div>
  );
}
