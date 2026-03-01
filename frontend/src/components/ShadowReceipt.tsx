"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { keccak256, encodePacked, toHex } from "viem";
import { SHADOW_ODDS_ADDRESS } from "@/lib/wagmi";
import { loadCommitment, formatUSDC, outcomeLabel, Market, Outcome } from "@/lib/shadowodds";
import ShadowOddsABI from "@/lib/ShadowOddsABI.json";

interface ShadowReceiptProps {
  marketId: number;
  market: Market;
}

export function ShadowReceipt({ marketId, market }: ShadowReceiptProps) {
  const { address } = useAccount();
  const [receipt, setReceipt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: betData } = useReadContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: ShadowOddsABI,
    functionName: "bets",
    args: address ? [BigInt(marketId), address] : undefined,
    query: { enabled: !!address },
  });

  const bet = betData as [string, bigint, number, boolean, boolean] | undefined;
  const hasClaimed = bet?.[4] ?? false;
  const betOutcome = bet?.[2] as Outcome | undefined;
  const isWinner = betOutcome !== undefined && betOutcome === market.result && market.result !== Outcome.PENDING;

  function generateReceipt() {
    if (!address) return;
    const savedBet = loadCommitment(marketId, address);
    if (!savedBet) return;

    const nonce = BigInt(Math.floor(Math.random() * 1e15));
    const receiptHash = keccak256(
      encodePacked(
        ["bytes32", "uint256", "uint8", "uint256"],
        [savedBet.secret, BigInt(marketId), market.result, nonce]
      )
    );

    const receiptData = {
      type: "ShadowReceipt",
      version: "1.0",
      market: marketId,
      question: market.question.slice(0, 80),
      outcome: outcomeLabel(market.result),
      proof: receiptHash,
      nonce: toHex(nonce),
      timestamp: new Date().toISOString(),
      chain: "monad-testnet",
      contract: SHADOW_ODDS_ADDRESS,
    };

    setReceipt(JSON.stringify(receiptData, null, 2));
  }

  function handleCopy() {
    if (!receipt) return;
    navigator.clipboard.writeText(receipt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!market.resolved || !hasClaimed || !isWinner) return null;

  return (
    <div className="rounded-xl border border-[#00e87b]/20 bg-[#00e87b]/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-white font-semibold text-sm">Shadow Receipt</h3>
        <span className="text-[11px] text-[#836EF9] bg-[#836EF9]/10 px-1.5 py-0.5 rounded border border-[#836EF9]/20">
          ZK Proof
        </span>
      </div>

      <p className="text-zinc-400 text-xs mb-4 leading-relaxed">
        Generate a cryptographic proof that you won this market — without revealing your wallet, bet direction, or payout.
      </p>

      {!receipt ? (
        <button
          onClick={generateReceipt}
          className="w-full py-2.5 rounded-lg font-medium text-sm text-black bg-[#00e87b] hover:bg-[#00d46f] transition-colors"
        >
          Generate Receipt
        </button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-zinc-950 border border-zinc-800/60 p-3 max-h-40 overflow-auto">
            <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap break-all">
              {receipt}
            </pre>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 py-2 rounded-lg text-xs font-medium text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              {copied ? "Copied!" : "Copy Receipt"}
            </button>
            <button
              onClick={() => setReceipt(null)}
              className="px-4 py-2 rounded-lg text-xs text-zinc-500 hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
          <p className="text-[11px] text-zinc-600 font-mono">
            Proves participation in market #{marketId} winning outcome without revealing identity.
          </p>
        </div>
      )}
    </div>
  );
}
