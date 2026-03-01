"use client";

import { useState } from "react";
import { useUnlink, useUnlinkBalance, useSend, useWithdraw, useBurner } from "@unlink-xyz/react";
import { useAccount, useWriteContract, useReadContract, useSendTransaction } from "wagmi";
import { parseAbi, formatUnits, parseUnits } from "viem";
import { USDC_ADDRESS, UNLINK_POOL_ADDRESS, SHADOW_ODDS_ADDRESS } from "@/lib/wagmi";

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

type Tab = "shield" | "transfer" | "burner";

function parseRelayError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("404") || msg.includes("server response")) {
    return "Unlink relay service unavailable on Monad testnet. Shield (deposit) works — relay ops (withdraw, transfer, fund) pending activation.";
  }
  if (msg.includes("User rejected")) return "Transaction rejected";
  return msg.slice(0, 150);
}

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
    deposit,
  } = useUnlink();

  const { balance: privateUsdcBalance } = useUnlinkBalance(USDC_ADDRESS);
  const { send: transfer, isPending: transferPending, error: transferError } = useSend();
  const { withdraw, isPending: withdrawPending } = useWithdraw();
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
      const depositResult = await deposit([{
        token: USDC_ADDRESS,
        amount: amountBigInt,
        depositor: address,
      }]);

      await sendTransactionAsync({
        to: depositResult.to as `0x${string}`,
        data: depositResult.calldata as `0x${string}`,
        value: depositResult.value ?? 0n,
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
      setWError(parseRelayError(e));
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
      setTError(parseRelayError(e));
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
      const activeBurner = burners[activeBurnerIdx];
      if (activeBurner) {
        const bal = await getTokenBalance(activeBurner.address, USDC_ADDRESS);
        setBurnerBalance(formatUnits(bal, 6));
      }
      setBurnerStep("idle");
      setBurnerFundAmt("");
    } catch (e) {
      setBurnerStep("error");
      setBurnerError(parseRelayError(e));
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
      setBurnerError(parseRelayError(e));
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
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5 animate-pulse">
        <div className="h-4 w-40 bg-zinc-800 rounded mb-3" />
        <div className="h-8 w-full bg-zinc-800 rounded" />
      </div>
    );
  }

  if (!walletExists) {
    return (
      <div className="rounded-xl border border-[#836EF9]/20 bg-[#836EF9]/5 p-5">
        <h3 className="text-white font-semibold mb-2 text-sm">Private Account (Unlink)</h3>
        <p className="text-zinc-400 text-xs mb-4">
          Shield your winnings with zero-knowledge privacy. Create an Unlink wallet to deposit USDC into a private account.
        </p>

        {savedMnemonic && (
          <div className="mb-4 rounded-lg border border-amber-800/50 bg-amber-900/10 p-3">
            <p className="text-amber-400 text-xs font-medium mb-1">Save your mnemonic!</p>
            <p className="text-xs font-mono text-zinc-300 break-all select-all">{savedMnemonic}</p>
          </div>
        )}

        <div className="space-y-2">
          <button
            onClick={handleCreateWallet}
            disabled={busy}
            className="w-full py-2.5 rounded-lg font-medium text-sm text-white bg-[#836EF9] hover:bg-[#7360e0] disabled:opacity-40 transition-colors"
          >
            {busy ? "Creating..." : "Create Private Wallet"}
          </button>

          {!showImport ? (
            <button
              onClick={() => setShowImport(true)}
              className="w-full text-xs text-zinc-500 hover:text-[#836EF9] transition-colors"
            >
              Import existing wallet
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={mnemonicInput}
                onChange={(e) => setMnemonicInput(e.target.value)}
                placeholder="Enter your mnemonic..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-white font-mono h-16 resize-none focus:outline-none focus:border-[#836EF9]"
              />
              <button
                onClick={handleImportWallet}
                disabled={busy || !mnemonicInput.trim()}
                className="w-full py-2 rounded-lg text-xs font-medium text-white bg-[#836EF9] hover:bg-[#7360e0] disabled:opacity-40 transition-colors"
              >
                Import
              </button>
            </div>
          )}
        </div>

        {errorMsg && <p className="text-xs text-red-400 mt-2">{errorMsg}</p>}
      </div>
    );
  }

  const fmtPrivate = privateUsdcBalance !== undefined
    ? Number(formatUnits(privateUsdcBalance, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 })
    : "...";
  const fmtPublic = publicBalance !== undefined
    ? Number(formatUnits(publicBalance as bigint, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 })
    : "...";

  const activeBurner = burners[activeBurnerIdx];

  const tabs: { key: Tab; label: string }[] = [
    { key: "shield", label: "Shield" },
    { key: "transfer", label: "Transfer" },
    { key: "burner", label: "Burner" },
  ];

  return (
    <div className="rounded-xl border border-[#836EF9]/20 bg-[#836EF9]/5 p-5 space-y-4">
      <h3 className="text-white font-semibold text-sm">Private Account (Unlink)</h3>

      {activeAccount && (
        <div className="rounded-lg bg-zinc-950 p-3 text-xs font-mono">
          <p className="text-zinc-600 mb-1">Private address</p>
          <p className="text-[#836EF9] break-all text-[11px]">{activeAccount.address}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/50 p-3">
          <p className="text-zinc-600 mb-1">Public USDC</p>
          <p className="text-white font-medium">${fmtPublic}</p>
        </div>
        <div className="rounded-lg border border-[#836EF9]/20 bg-[#836EF9]/10 p-3">
          <p className="text-zinc-600 mb-1">Private USDC</p>
          <p className="text-[#836EF9] font-medium">${fmtPrivate}</p>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg bg-zinc-950 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === t.key
                ? "bg-[#836EF9] text-white"
                : "text-zinc-500 hover:text-zinc-300"
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* SHIELD TAB */}
      {activeTab === "shield" && (
        <div className="space-y-3">
          {step === "done" ? (
            <div className="rounded-lg border border-[#00e87b]/20 bg-[#00e87b]/5 p-3 text-center">
              <p className="text-[#00e87b] text-xs font-medium">USDC shielded! Now private.</p>
              <button onClick={() => setStep("idle")} className="text-xs text-zinc-500 mt-1 hover:text-white transition-colors">Shield more</button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs text-zinc-500">Shield USDC (public to private)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={shieldAmount}
                  onChange={(e) => setShieldAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#836EF9]"
                />
                <button
                  onClick={handleShield}
                  disabled={busy || step === "approving" || step === "depositing" || !shieldAmount || !address}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-white bg-[#836EF9] hover:bg-[#7360e0] disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  {step === "approving" ? "Approving..." : step === "depositing" ? "Shielding..." : "Shield"}
                </button>
              </div>
              {publicBalance && (
                <button
                  onClick={() => setShieldAmount(formatUnits(publicBalance as bigint, 6))}
                  className="text-[11px] text-zinc-600 hover:text-[#836EF9] transition-colors"
                >
                  Shield all ({formatUnits(publicBalance as bigint, 6)} USDC)
                </button>
              )}
            </div>
          )}
          {step === "error" && <p className="text-xs text-red-400">{errorMsg}</p>}

          <div className="border-t border-zinc-800/60 pt-3 space-y-2">
            <label className="text-xs text-zinc-500">Withdraw (private to any address)</label>
            {wStep === "done" ? (
              <div className="rounded-lg border border-[#00e87b]/20 bg-[#00e87b]/5 p-3 text-center">
                <p className="text-[#00e87b] text-xs font-medium">Withdrawn! Check destination wallet.</p>
                <button onClick={() => setWStep("idle")} className="text-xs text-zinc-500 mt-1 hover:text-white transition-colors">Withdraw more</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={withdrawAddr}
                  onChange={(e) => setWithdrawAddr(e.target.value)}
                  placeholder="0x... recipient address"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-[#836EF9]"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#836EF9]"
                  />
                  <button
                    onClick={handleWithdraw}
                    disabled={busy || wStep === "withdrawing" || withdrawPending || !withdrawAmount || !withdrawAddr}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-white bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    {wStep === "withdrawing" ? "..." : "Withdraw"}
                  </button>
                </div>
              </>
            )}
            {wStep === "error" && <p className="text-xs text-red-400">{wError}</p>}
          </div>
        </div>
      )}

      {/* TRANSFER TAB */}
      {activeTab === "transfer" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-[#00e87b]/15 bg-[#00e87b]/5 p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00e87b]" />
              <span className="text-[11px] text-[#00e87b] font-medium">Maximum Privacy</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Sender, recipient, and amount are all hidden by ZK proofs. No on-chain trace.
            </p>
          </div>

          {tStep === "done" ? (
            <div className="rounded-lg border border-[#00e87b]/20 bg-[#00e87b]/5 p-3 text-center">
              <p className="text-[#00e87b] text-xs font-medium">Private transfer complete!</p>
              <p className="text-[11px] text-zinc-500 mt-1">Zero on-chain footprint.</p>
              <button onClick={() => setTStep("idle")} className="text-xs text-zinc-500 mt-2 hover:text-white transition-colors">Send again</button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs text-zinc-500">Recipient (unlink1... address)</label>
              <input
                type="text"
                value={transferRecipient}
                onChange={(e) => setTransferRecipient(e.target.value)}
                placeholder="unlink1..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-[#00e87b]"
              />
              <label className="text-xs text-zinc-500">Amount (USDC)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#00e87b]"
                />
                <button
                  onClick={handleTransfer}
                  disabled={transferPending || tStep === "sending" || !transferRecipient || !transferAmount}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  {tStep === "sending" || transferPending ? "Sending..." : "Send Private"}
                </button>
              </div>
              {privateUsdcBalance !== undefined && (
                <button
                  onClick={() => setTransferAmount(formatUnits(privateUsdcBalance, 6))}
                  className="text-[11px] text-zinc-600 hover:text-[#00e87b] transition-colors"
                >
                  Send all ({formatUnits(privateUsdcBalance, 6)} USDC)
                </button>
              )}
            </div>
          )}
          {(tStep === "error" || transferError) && (
            <p className="text-xs text-red-400">{tError || transferError?.message}</p>
          )}
        </div>
      )}

      {/* BURNER TAB */}
      {activeTab === "burner" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-medium text-amber-400">Anonymous Betting</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Create a burner wallet, fund from shielded pool, bet anonymously, sweep winnings back to privacy.
            </p>
          </div>

          {!activeBurner ? (
            <button
              onClick={handleCreateBurner}
              disabled={burnerStep === "creating"}
              className="w-full py-2.5 rounded-lg font-medium text-xs text-black bg-amber-400 hover:bg-amber-500 disabled:opacity-40 transition-colors"
            >
              {burnerStep === "creating" ? "Creating..." : "Create Burner Wallet"}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg bg-zinc-950 p-3 text-xs font-mono space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600">Burner #{activeBurnerIdx}</span>
                  <span className="text-[11px] text-amber-400 px-1.5 py-0.5 rounded bg-amber-400/10 border border-amber-400/20">anonymous</span>
                </div>
                <p className="text-zinc-400 break-all text-[11px]">{activeBurner.address}</p>
                <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
                  <span className="text-zinc-600">USDC Balance</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{burnerBalance ?? "—"}</span>
                    <button onClick={refreshBurnerBalance} className="text-[11px] text-zinc-600 hover:text-amber-400 transition-colors">refresh</button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-zinc-500">Fund from shielded pool</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={burnerFundAmt}
                    onChange={(e) => setBurnerFundAmt(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-amber-400"
                  />
                  <button
                    onClick={handleFundBurner}
                    disabled={burnerStep === "funding" || burnerFund.isPending || !burnerFundAmt}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-black bg-amber-400 hover:bg-amber-500 disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    {burnerStep === "funding" || burnerFund.isPending ? "Funding..." : "Fund"}
                  </button>
                </div>
              </div>

              <button
                onClick={handleSweepBurner}
                disabled={burnerStep === "sweeping" || burnerSweep.isPending}
                className="w-full py-2 rounded-lg text-xs font-medium text-[#836EF9] border border-[#836EF9]/30 hover:bg-[#836EF9]/10 disabled:opacity-40 transition-colors"
              >
                {burnerStep === "sweeping" || burnerSweep.isPending ? "Sweeping..." : "Sweep All Back to Privacy Pool"}
              </button>

              {burnerStep === "done" && (
                <div className="rounded-lg border border-[#00e87b]/20 bg-[#00e87b]/5 p-3 text-center">
                  <p className="text-[#00e87b] text-xs font-medium">Funds swept back to private pool!</p>
                  <button onClick={() => setBurnerStep("idle")} className="text-xs text-zinc-500 mt-1 hover:text-white transition-colors">Continue</button>
                </div>
              )}
            </div>
          )}

          {burnerError && <p className="text-xs text-red-400">{burnerError}</p>}
        </div>
      )}

      <div className="border-t border-zinc-800/60 pt-3 text-xs text-zinc-600 space-y-1">
        <p>Shielded USDC is hidden by zero-knowledge proofs.</p>
        <p>Transfer privately or withdraw to any address — breaking the link.</p>
      </div>
    </div>
  );
}
