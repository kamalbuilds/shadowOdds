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
        className="relative px-5 py-2.5 rounded-lg font-semibold text-sm text-black bg-[#00FF94] hover:bg-[#00e085] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        style={{ boxShadow: "0 0 20px #00FF9440" }}
      >
        {isConnecting ? (
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
            Connecting...
          </span>
        ) : (
          "Connect Wallet"
        )}
      </button>
    );
  }

  if (isWrongChain) {
    return (
      <button
        onClick={() => switchChain({ chainId: monadTestnet.id })}
        disabled={isSwitching}
        className="px-5 py-2.5 rounded-lg font-semibold text-sm text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        style={{ boxShadow: "0 0 20px #7C3AED40" }}
      >
        {isSwitching ? (
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Switching...
          </span>
        ) : (
          "Switch to Monad Testnet"
        )}
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-gray-700 bg-[#111] hover:border-[#00FF9460] hover:bg-[#111] transition-all text-sm"
      >
        <span className="w-2 h-2 rounded-full bg-[#00FF94] pulse-green" />
        <span className="font-mono text-[#00FF94] font-medium">
          {truncateAddress(address!)}
        </span>
        <span className="text-gray-500 text-xs">{chain?.name ?? "Unknown"}</span>
        <svg
          className={`w-3 h-3 text-gray-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-gray-800 bg-[#111] shadow-2xl z-50 overflow-hidden">
          <div className="p-3 border-b border-gray-800">
            <p className="text-xs text-gray-500 mb-1">Connected to</p>
            <p className="font-mono text-xs text-[#00FF94]">{address}</p>
          </div>
          <div className="p-1">
            <button
              onClick={() => {
                disconnect();
                setDropdownOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-sm text-red-400 hover:bg-red-950/30 rounded-lg transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
