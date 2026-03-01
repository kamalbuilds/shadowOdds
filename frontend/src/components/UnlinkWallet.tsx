"use client";

import { useState } from "react";
import { useUnlink, useUnlinkBalance, useTransfer, useWithdraw, useBurner } from "@unlink-xyz/react";
import { useAccount, useWriteContract, useReadContract, useSendTransaction } from "wagmi";
import { parseAbi, formatUnits, parseUnits } from "viem";
import { USDC_ADDRESS, UNLINK_POOL_ADDRESS, SHADOW_ODDS_ADDRESS } from "@/lib/wagmi";

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

type Tab = "shield" | "transfer" | "burner";

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
  } = useUnlink();

  const { balance: privateUsdcBalance } = useUnlinkBalance(USDC_ADDRESS);
  const { execute: transfer, isPending: transferPending, error: transferError } = useTransfer();
  const { execute: withdraw, isPending: withdrawPending } = useWithdraw();
  const {
    burners,
    createBurner,
    fund: burnerFund,
    send: burnerSend,
    sweepToPool: burnerSweep,
    getTokenBalance,
  } = useBurner();

  const [activeTab, setActiveTab] = useState<Tab>("shield");
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

  // Transfer state
  const [transferRecipient, setTransferRecipient] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [tStep, setTStep] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [tError, setTError] = useState("");

  // Burner state
  const [burnerStep, setBurnerStep] = useState<"idle" | "creating" | "funding" | "betting" | "sweeping" | "done" | "error">("idle");
  const [burnerError, setBurnerError] = useState("");
  const [burnerFundAmt, setBurnerFundAmt] = useState("");
  const [activeBurnerIdx] = useState(0);
  const [burnerBalance, setBurnerBalance] = useState<string | null>(null);

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

      setStep("depositing");
      const deposit = await requestDeposit([{
        token: USDC_ADDRESS,
        amount: amountBigInt,
        depositor: address,
      }]);

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
      await withdraw([{
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

  async function handleTransfer() {
    if (!transferRecipient || !transferAmount) return;
    setTError("");
    setTStep("sending");
    try {
      await transfer([{
        token: USDC_ADDRESS,
        recipient: transferRecipient,
        amount: parseUnits(transferAmount, 6),
      }]);
      setTStep("done");
      setTransferRecipient("");
      setTransferAmount("");
    } catch (e) {
      setTStep("error");
      setTError(e instanceof Error ? e.message.slice(0, 120) : "Transfer failed");
    }
  }

  async function handleCreateBurner() {
    setBurnerError("");
    setBurnerStep("creating");
    try {
      await createBurner(activeBurnerIdx);
      setBurnerStep("idle");
    } catch (e) {
      setBurnerStep("error");
      setBurnerError(e instanceof Error ? e.message.slice(0, 120) : "Failed to create burner");
    }
  }

  async function handleFundBurner() {
    if (!burnerFundAmt) return;
    setBurnerError("");
    setBurnerStep("funding");
    try {
      await burnerFund.execute({
        index: activeBurnerIdx,
        params: { token: USDC_ADDRESS, amount: parseUnits(burnerFundAmt, 6) },
      });
      // Refresh burner balance
      const activeBurner = burners[activeBurnerIdx];
      if (activeBurner) {
        const bal = await getTokenBalance(activeBurner.address, USDC_ADDRESS);
        setBurnerBalance(formatUnits(bal, 6));
      }
      setBurnerStep("idle");
      setBurnerFundAmt("");
    } catch (e) {
      setBurnerStep("error");
      setBurnerError(e instanceof Error ? e.message.slice(0, 120) : "Fund failed");
    }
  }

  async function handleSweepBurner() {
    setBurnerError("");
    setBurnerStep("sweeping");
    try {
      await burnerSweep.execute({
        index: activeBurnerIdx,
        params: { token: USDC_ADDRESS },
      });
      setBurnerBalance("0");
      setBurnerStep("done");
    } catch (e) {
      setBurnerStep("error");
      setBurnerError(e instanceof Error ? e.message.slice(0, 120) : "Sweep failed");
    }
  }

  async function refreshBurnerBalance() {
    const activeBurner = burners[activeBurnerIdx];
    if (activeBurner) {
      const bal = await getTokenBalance(activeBurner.address, USDC_ADDRESS);
      setBurnerBalance(formatUnits(bal, 6));
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

  // Wallet exists — full private wallet UI
  const fmtPrivate = privateUsdcBalance !== undefined
    ? Number(formatUnits(privateUsdcBalance, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 })
    : "...";
  const fmtPublic = publicBalance !== undefined
    ? Number(formatUnits(publicBalance as bigint, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 })
    : "...";

  const activeBurner = burners[activeBurnerIdx];

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "shield", label: "Shield", icon: "D" },
    { key: "transfer", label: "Transfer", icon: "T" },
    { key: "burner", label: "Burner", icon: "B" },
  ];

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

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg bg-[#0A0A0A] p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-1.5 rounded-md text-[10px] font-mono font-bold transition-all ${
              activeTab === t.key
                ? "bg-[#7C3AED] text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <span className="mr-1">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* SHIELD TAB */}
      {activeTab === "shield" && (
        <div className="space-y-3">
          {/* Shield (deposit) */}
          {step === "done" ? (
            <div className="rounded-lg border border-[#00FF9440] bg-[#00FF9410] p-3 text-center">
              <p className="text-[#00FF94] text-xs font-bold">USDC shielded! Now private.</p>
              <button onClick={() => setStep("idle")} className="text-xs text-gray-500 mt-1 hover:text-white">Shield more</button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs text-gray-500 font-mono">Shield USDC (public → private)</label>
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

          {/* Withdraw */}
          <div className="border-t border-gray-800 pt-3 space-y-2">
            <label className="text-xs text-gray-500 font-mono">Withdraw (private → any address)</label>
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
                    disabled={busy || wStep === "withdrawing" || withdrawPending || !withdrawAmount || !withdrawAddr}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-40 transition-all whitespace-nowrap"
                  >
                    {wStep === "withdrawing" ? "..." : "Withdraw"}
                  </button>
                </div>
              </>
            )}
            {wStep === "error" && <p className="text-xs text-red-400 font-mono">{wError}</p>}
          </div>
        </div>
      )}

      {/* TRANSFER TAB — Private P2P */}
      {activeTab === "transfer" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-[#00FF9420] bg-[#00FF9408] p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-[#00FF94]" />
              <span className="text-[10px] text-[#00FF94] font-mono font-bold uppercase tracking-wider">Maximum Privacy</span>
            </div>
            <p className="text-[10px] text-gray-500 font-mono">
              Sender, recipient, and amount are ALL hidden by ZK proofs. No on-chain trace.
            </p>
          </div>

          {tStep === "done" ? (
            <div className="rounded-lg border border-[#00FF9440] bg-[#00FF9410] p-3 text-center">
              <p className="text-[#00FF94] text-xs font-bold">Private transfer complete!</p>
              <p className="text-[10px] text-gray-500 mt-1 font-mono">Zero on-chain footprint.</p>
              <button onClick={() => setTStep("idle")} className="text-xs text-gray-500 mt-2 hover:text-white">Send again</button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs text-gray-500 font-mono">Recipient (unlink1... address)</label>
              <input
                type="text"
                value={transferRecipient}
                onChange={(e) => setTransferRecipient(e.target.value)}
                placeholder="unlink1..."
                className="w-full bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-[#00FF94]"
              />
              <label className="text-xs text-gray-500 font-mono">Amount (USDC)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#00FF94]"
                />
                <button
                  onClick={handleTransfer}
                  disabled={transferPending || tStep === "sending" || !transferRecipient || !transferAmount}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-black bg-[#00FF94] hover:bg-[#00cc77] disabled:opacity-40 transition-all whitespace-nowrap"
                >
                  {tStep === "sending" || transferPending ? "Sending..." : "Send Private"}
                </button>
              </div>
              {privateUsdcBalance !== undefined && (
                <button
                  onClick={() => setTransferAmount(formatUnits(privateUsdcBalance, 6))}
                  className="text-[10px] text-gray-600 hover:text-[#00FF94] font-mono"
                >
                  Send all ({formatUnits(privateUsdcBalance, 6)} USDC)
                </button>
              )}
            </div>
          )}
          {(tStep === "error" || transferError) && (
            <p className="text-xs text-red-400 font-mono">{tError || transferError?.message}</p>
          )}
        </div>
      )}

      {/* BURNER TAB — Anonymous Betting */}
      {activeTab === "burner" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-[#F59E0B20] bg-[#F59E0B08] p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono font-bold text-[#F59E0B] uppercase tracking-wider">Anonymous Betting</span>
            </div>
            <p className="text-[10px] text-gray-500 font-mono">
              Create a burner wallet, fund it from your shielded pool, bet anonymously, then sweep winnings back to privacy.
            </p>
          </div>

          {/* Burner status */}
          {!activeBurner ? (
            <button
              onClick={handleCreateBurner}
              disabled={burnerStep === "creating"}
              className="w-full py-3 rounded-xl font-bold text-xs text-white bg-[#F59E0B] hover:bg-[#d97706] disabled:opacity-40 transition-all"
            >
              {burnerStep === "creating" ? "Creating..." : "Create Burner Wallet"}
            </button>
          ) : (
            <div className="space-y-3">
              {/* Burner info card */}
              <div className="rounded-lg bg-[#0A0A0A] p-3 text-xs font-mono space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Burner #{activeBurnerIdx}</span>
                  <span className="text-[9px] text-[#F59E0B] px-1.5 py-0.5 rounded bg-[#F59E0B15] font-bold">ANONYMOUS</span>
                </div>
                <p className="text-gray-400 break-all text-[11px]">{activeBurner.address}</p>
                <div className="flex items-center justify-between pt-1 border-t border-gray-800">
                  <span className="text-gray-600">USDC Balance</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{burnerBalance ?? "—"}</span>
                    <button onClick={refreshBurnerBalance} className="text-[9px] text-gray-600 hover:text-[#F59E0B]">refresh</button>
                  </div>
                </div>
              </div>

              {/* Fund burner */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500 font-mono">Fund from shielded pool</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={burnerFundAmt}
                    onChange={(e) => setBurnerFundAmt(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-[#0A0A0A] border border-gray-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
                  />
                  <button
                    onClick={handleFundBurner}
                    disabled={burnerStep === "funding" || burnerFund.isPending || !burnerFundAmt}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-black bg-[#F59E0B] hover:bg-[#d97706] disabled:opacity-40 transition-all whitespace-nowrap"
                  >
                    {burnerStep === "funding" || burnerFund.isPending ? "Funding..." : "Fund"}
                  </button>
                </div>
              </div>

              {/* Sweep back to pool */}
              <button
                onClick={handleSweepBurner}
                disabled={burnerStep === "sweeping" || burnerSweep.isPending}
                className="w-full py-2 rounded-lg text-xs font-bold text-[#7C3AED] border border-[#7C3AED40] hover:bg-[#7C3AED10] disabled:opacity-40 transition-all"
              >
                {burnerStep === "sweeping" || burnerSweep.isPending ? "Sweeping..." : "Sweep All Back to Privacy Pool"}
              </button>

              {burnerStep === "done" && (
                <div className="rounded-lg border border-[#00FF9440] bg-[#00FF9410] p-3 text-center">
                  <p className="text-[#00FF94] text-xs font-bold">Burner funds swept back to private pool!</p>
                  <button onClick={() => setBurnerStep("idle")} className="text-xs text-gray-500 mt-1 hover:text-white">Continue</button>
                </div>
              )}
            </div>
          )}

          {burnerError && <p className="text-xs text-red-400 font-mono">{burnerError}</p>}

          {/* Flow diagram */}
          <div className="rounded-lg bg-[#0A0A0A] p-3 text-[9px] font-mono text-gray-600 space-y-1">
            <p className="text-gray-500 font-bold mb-1">FLOW:</p>
            <p>1. Create burner → ephemeral wallet</p>
            <p>2. Fund from shielded pool → ZK withdraw to burner</p>
            <p>3. Bet anonymously → no link to your identity</p>
            <p>4. Sweep winnings → back into ZK privacy pool</p>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="border-t border-gray-800 pt-3 text-xs text-gray-600 space-y-1">
        <p>Shielded USDC is hidden by zero-knowledge proofs.</p>
        <p>Transfer privately or withdraw to <span className="text-gray-400">any</span> address — breaking the link.</p>
      </div>
    </div>
  );
}
