"use client";

import { useState } from "react";
import { useUnlink, useUnlinkBalance } from "@unlink-xyz/react";
import { useAccount, useWriteContract, useReadContract, useSendTransaction } from "wagmi";
import { parseAbi, formatUnits, parseUnits } from "viem";
import { USDC_ADDRESS, UNLINK_POOL_ADDRESS } from "@/lib/wagmi";

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

export function UnlinkWallet() {
  const { address } = useAccount();
  const {
    ready,
    walletExists,
    activeAccount,
    busy,
    createWallet,
    importWallet,
    createAccount,
    requestDeposit,
    requestWithdraw,
  } = useUnlink();

  const { balance: privateUsdcBalance } = useUnlinkBalance(USDC_ADDRESS);

  const [savedMnemonic, setSavedMnemonic] = useState("");
  const [mnemonicInput, setMnemonicInput] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [shieldAmount, setShieldAmount] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "depositing" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAddr, setWithdrawAddr] = useState("");
  const [wStep, setWStep] = useState<"idle" | "withdrawing" | "done" | "error">("idle");
  const [wError, setWError] = useState("");

  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, UNLINK_POOL_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const { data: publicBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  async function handleCreateWallet() {
    try {
      const { mnemonic } = await createWallet();
      setSavedMnemonic(mnemonic);
      await createAccount();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to create wallet");
    }
  }

  async function handleImportWallet() {
    try {
      await importWallet(mnemonicInput.trim());
      setShowImport(false);
      setMnemonicInput("");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to import wallet");
    }
  }

  async function handleShield() {
    if (!address || !shieldAmount) return;
    const amountBigInt = parseUnits(shieldAmount, 6);
    setErrorMsg("");

    try {
      // Approve USDC for Unlink pool if needed
      const needsApproval = !allowance || (allowance as bigint) < amountBigInt;
      if (needsApproval) {
        setStep("approving");
        await writeContractAsync({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [UNLINK_POOL_ADDRESS, amountBigInt],
        });
        await refetchAllowance();
      }

      // Generate deposit calldata from Unlink SDK
      setStep("depositing");
      const deposit = await requestDeposit([{
        token: USDC_ADDRESS,
        amount: amountBigInt,
        depositor: address,
      }]);

      // Submit deposit tx via wagmi
      await sendTransactionAsync({
        to: deposit.to as `0x${string}`,
        data: deposit.calldata as `0x${string}`,
        value: deposit.value ?? 0n,
      });

      setStep("done");
      setShieldAmount("");
    } catch (e) {
      setStep("error");
      const msg = e instanceof Error ? e.message : "Shield failed";
      setErrorMsg(msg.includes("User rejected") ? "Transaction rejected" : msg.slice(0, 150));
    }
  }

  async function handleWithdraw() {
    if (!withdrawAmount || !withdrawAddr) return;
    setWError("");
    setWStep("withdrawing");
    try {
      await requestWithdraw([{
        token: USDC_ADDRESS,
        amount: parseUnits(withdrawAmount, 6),
        recipient: withdrawAddr,
      }]);
      setWStep("done");
      setWithdrawAmount("");
      setWithdrawAddr("");
    } catch (e) {
      setWStep("error");
      setWError(e instanceof Error ? e.message.slice(0, 120) : "Withdraw failed");
    }
  }

  if (!ready) {
    return (
      <div className="rounded-xl border border-gray-800 bg-[#111] p-5 animate-pulse">
        <div className="h-4 w-40 bg-gray-800 rounded mb-3" />
        <div className="h-8 w-full bg-gray-800 rounded" />
      </div>
    );
  }

  // No wallet yet — creation UI
  if (!walletExists) {
    return (
      <div className="rounded-xl border border-[#7C3AED40] bg-[#7C3AED08] p-5">
        <h3 className="text-white font-bold mb-2 text-sm flex items-center gap-2">
          <span className="text-[#7C3AED]">&#x1f6e1;</span> Private Account (Unlink)
        </h3>
        <p className="text-gray-400 text-xs mb-4">
          Shield your winnings with zero-knowledge privacy. Create an Unlink wallet to deposit USDC into a private account.
        </p>

        {savedMnemonic && (
          <div className="mb-4 rounded-lg border border-yellow-800/50 bg-yellow-900/10 p-3">
            <p className="text-yellow-400 text-xs font-bold mb-1">Save your mnemonic!</p>
            <p className="text-xs font-mono text-gray-300 break-all select-all">{savedMnemonic}</p>
          </div>
        )}

        <div className="space-y-2">
          <button
            onClick={handleCreateWallet}
            disabled={busy}
            className="w-full py-3 rounded-xl font-bold text-sm text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-40 transition-all"
          >
            {busy ? "Creating..." : "Create Private Wallet"}
          </button>

          {!showImport ? (
            <button
              onClick={() => setShowImport(true)}
              className="w-full text-xs text-gray-500 hover:text-[#7C3AED] transition-colors"
            >
              Import existing wallet
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={mnemonicInput}
                onChange={(e) => setMnemonicInput(e.target.value)}
                placeholder="Enter your mnemonic..."
                className="w-full bg-[#0A0A0A] border border-gray-800 rounded-lg p-2 text-xs text-white font-mono h-16 resize-none focus:outline-none focus:border-[#7C3AED]"
              />
              <button
                onClick={handleImportWallet}
                disabled={busy || !mnemonicInput.trim()}
                className="w-full py-2 rounded-lg text-xs font-bold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-40"
              >
                Import
              </button>
            </div>
          )}
        </div>

        {errorMsg && <p className="text-xs text-red-400 font-mono mt-2">{errorMsg}</p>}
      </div>
    );
  }

  // Wallet exists — balance + shield/withdraw
  const fmtPrivate = privateUsdcBalance !== undefined
    ? Number(formatUnits(privateUsdcBalance, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 })
    : "...";
  const fmtPublic = publicBalance !== undefined
    ? Number(formatUnits(publicBalance as bigint, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 })
    : "...";

  return (
    <div className="rounded-xl border border-[#7C3AED40] bg-[#7C3AED08] p-5 space-y-4">
      <h3 className="text-white font-bold text-sm flex items-center gap-2">
        <span className="text-[#7C3AED]">&#x1f6e1;</span> Private Account (Unlink)
      </h3>

      {/* Private address */}
      {activeAccount && (
        <div className="rounded-lg bg-[#0A0A0A] p-3 text-xs font-mono">
          <p className="text-gray-600 mb-1">Private address</p>
          <p className="text-[#7C3AED] break-all text-[11px]">{activeAccount.address}</p>
        </div>
      )}

      {/* Balances */}
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <div className="rounded-lg border border-gray-800 bg-[#111] p-3">
          <p className="text-gray-600 mb-1">Public USDC</p>
          <p className="text-white font-bold">${fmtPublic}</p>
        </div>
        <div className="rounded-lg border border-[#7C3AED40] bg-[#7C3AED10] p-3">
          <p className="text-gray-600 mb-1">Private USDC</p>
          <p className="text-[#7C3AED] font-bold">${fmtPrivate}</p>
        </div>
      </div>

      {/* Shield action (deposit public → private) */}
      {step === "done" ? (
        <div className="rounded-lg border border-[#00FF9440] bg-[#00FF9410] p-3 text-center">
          <p className="text-[#00FF94] text-xs font-bold">USDC shielded! Now private.</p>
          <button onClick={() => setStep("idle")} className="text-xs text-gray-500 mt-1 hover:text-white">Shield more</button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-xs text-gray-500 font-mono">Shield USDC (public -&gt; private)</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={shieldAmount}
              onChange={(e) => setShieldAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#7C3AED]"
            />
            <button
              onClick={handleShield}
              disabled={busy || step === "approving" || step === "depositing" || !shieldAmount || !address}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-40 transition-all whitespace-nowrap"
            >
              {step === "approving" ? "Approving..." : step === "depositing" ? "Shielding..." : "Shield"}
            </button>
          </div>
          {publicBalance && (
            <button
              onClick={() => setShieldAmount(formatUnits(publicBalance as bigint, 6))}
              className="text-[10px] text-gray-600 hover:text-[#7C3AED] font-mono"
            >
              Shield all ({formatUnits(publicBalance as bigint, 6)} USDC)
            </button>
          )}
        </div>
      )}

      {step === "error" && <p className="text-xs text-red-400 font-mono">{errorMsg}</p>}

      {/* Withdraw (private → any public address) */}
      <div className="border-t border-gray-800 pt-3 space-y-2">
        <label className="text-xs text-gray-500 font-mono">Withdraw (private -&gt; any address)</label>
        {wStep === "done" ? (
          <div className="rounded-lg border border-[#00FF9440] bg-[#00FF9410] p-3 text-center">
            <p className="text-[#00FF94] text-xs font-bold">Withdrawn! Check destination wallet.</p>
            <button onClick={() => setWStep("idle")} className="text-xs text-gray-500 mt-1 hover:text-white">Withdraw more</button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={withdrawAddr}
              onChange={(e) => setWithdrawAddr(e.target.value)}
              placeholder="0x... recipient address"
              className="w-full bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-[#7C3AED]"
            />
            <div className="flex gap-2">
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#7C3AED]"
              />
              <button
                onClick={handleWithdraw}
                disabled={busy || wStep === "withdrawing" || !withdrawAmount || !withdrawAddr}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-40 transition-all whitespace-nowrap"
              >
                {wStep === "withdrawing" ? "..." : "Withdraw"}
              </button>
            </div>
          </>
        )}
        {wStep === "error" && <p className="text-xs text-red-400 font-mono">{wError}</p>}
      </div>

      {/* Info */}
      <div className="border-t border-gray-800 pt-3 text-xs text-gray-600 space-y-1">
        <p>Shielded USDC is hidden by zero-knowledge proofs.</p>
        <p>Transfer privately or withdraw to <span className="text-gray-400">any</span> address — breaking the link.</p>
      </div>
    </div>
  );
}
