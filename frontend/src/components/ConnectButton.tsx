"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useState, useRef, useEffect } from "react";
import { monadTestnet } from "@/lib/wagmi";
import { injected } from "wagmi/connectors";

export function ConnectButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isWrongChain = isConnected && chain?.id !== monadTestnet.id;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function truncateAddress(addr: string) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: injected() })}
        disabled={isConnecting}
        className="px-4 py-2 rounded-lg font-medium text-sm text-black bg-[#00e87b] hover:bg-[#00d46f] disabled:opacity-50 transition-colors"
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
    );
  }

  if (isWrongChain) {
    return (
      <button
        onClick={() => switchChain({ chainId: monadTestnet.id })}
        disabled={isSwitching}
        className="px-4 py-2 rounded-lg font-medium text-sm text-white bg-[#836EF9] hover:bg-[#7360e0] disabled:opacity-50 transition-colors"
      >
        {isSwitching ? "Switching..." : "Switch to Monad"}
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors text-sm"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#00e87b]" />
        <span className="font-mono text-zinc-300 text-[13px]">
          {truncateAddress(address!)}
        </span>
        <svg
          className={`w-3 h-3 text-zinc-600 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 mt-1.5 w-52 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl z-50 overflow-hidden">
          <div className="p-3 border-b border-zinc-800/60">
            <p className="text-[11px] text-zinc-500 mb-1">Connected</p>
            <p className="font-mono text-xs text-zinc-300 break-all">{address}</p>
          </div>
          <div className="p-1">
            <button
              onClick={() => { disconnect(); setDropdownOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-400/5 rounded-md transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
