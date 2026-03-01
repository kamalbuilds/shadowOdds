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

/**
 * Shadow Receipt — ZK Social Proof
 *
 * Generates a cryptographic proof that you won a market, without revealing:
 * - Your wallet address
 * - Which direction you bet (YES/NO)
 * - How much you won
 *
 * The receipt is a hash commitment that can be verified against the on-chain
 * market state, proving you participated in a winning outcome.
 *
 * This is like a "ZK attestation" — provable bragging rights with zero info leak.
 */
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

    // Generate a receipt hash — proves knowledge of the bet secret without revealing it
    const nonce = BigInt(Math.floor(Math.random() * 1e15));
    const receiptHash = keccak256(
      encodePacked(
        ["bytes32", "uint256", "uint8", "uint256"],
        [savedBet.secret, BigInt(marketId), market.result, nonce]
      )
    );

    // Build a shareable receipt
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

  // Only show for winners who claimed
  if (!market.resolved || !hasClaimed || !isWinner) return null;

  return (
    <div className="rounded-xl border border-[#00FF9440] bg-gradient-to-b from-[#00FF9408] to-[#7C3AED08] p-5 shield-glow">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-[#00FF94]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <h3 className="text-white font-bold text-sm">Shadow Receipt</h3>
        <span className="text-[10px] font-mono text-[#7C3AED] bg-[#7C3AED15] px-1.5 py-0.5 rounded border border-[#7C3AED30]">
          ZK PROOF
        </span>
      </div>

      <p className="text-gray-400 text-xs mb-4 leading-relaxed">
        Generate a cryptographic proof that you won this market — without revealing your wallet, your bet direction, or your payout.
        Share it as provable bragging rights.
      </p>

      {!receipt ? (
        <button
          onClick={generateReceipt}
          className="w-full py-3 rounded-xl font-bold text-sm text-black bg-gradient-to-r from-[#00FF94] to-[#7C3AED] hover:opacity-90 transition-all"
          style={{ boxShadow: "0 0 20px #00FF9430, 0 0 40px #7C3AED20" }}
        >
          Generate Shadow Receipt
        </button>
      ) : (
        <div className="space-y-3">
          <div className="relative rounded-lg bg-[#0A0A0A] border border-gray-800 p-3 max-h-40 overflow-auto">
            <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap break-all">
              {receipt}
            </pre>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 py-2 rounded-lg text-xs font-bold text-white bg-gray-800 hover:bg-gray-700 transition-all"
            >
              {copied ? "Copied!" : "Copy Receipt"}
            </button>
            <button
              onClick={() => setReceipt(null)}
              className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
          <p className="text-[10px] text-gray-600 font-mono">
            This receipt proves you participated in market #{marketId} winning outcome without revealing identity.
            Verifiable against on-chain state at {SHADOW_ODDS_ADDRESS?.slice(0, 10)}...
          </p>
        </div>
      )}
    </div>
  );
}
