"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import {
  loadAllLimitOrders,
  type SavedLimitOrder,
  type TriggerDirection,
} from "@/lib/shadowodds";
import { SHADOW_LIMIT_ORDER_ADDRESS, PYTH_HERMES_URL, feedInfo } from "@/lib/wagmi";
import ShadowLimitOrderABI from "@/lib/ShadowLimitOrderABI.json";

interface LimitOrderStatusProps {
  marketId: number;
  feedId: string;
}

export function LimitOrderStatus({ marketId, feedId }: LimitOrderStatusProps) {
  const { address } = useAccount();
  const [orders, setOrders] = useState<SavedLimitOrder[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [executing, setExecuting] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [executedIds, setExecutedIds] = useState<Set<number>>(new Set());
  const [cancelledIds, setCancelledIds] = useState<Set<number>>(new Set());
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const asset = feedInfo(feedId);

  // Load orders from localStorage
  useEffect(() => {
    if (!address) return;
    const all = loadAllLimitOrders(address);
    setOrders(all.filter((o) => o.marketId === marketId));
  }, [address, marketId]);

  // Poll live price for auto-execution
  const fetchPrice = useCallback(async () => {
    if (!feedId || feedId === "0x" + "0".repeat(64)) return;
    try {
      const res = await fetch(`${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`);
      const json = await res.json();
      const p = json?.parsed?.[0]?.price;
      if (p) setLivePrice(Number(p.price) * Math.pow(10, p.expo));
    } catch { /* */ }
  }, [feedId]);

  useEffect(() => {
    fetchPrice();
    const id = setInterval(fetchPrice, 4000);
    return () => clearInterval(id);
  }, [fetchPrice]);

  // Check if trigger is met
  function isTriggerMet(order: SavedLimitOrder, price: number): boolean {
    const trigger = Number(order.triggerPrice) / 1e8;
    if (order.triggerDir === "ABOVE_OR_EQUAL") return price >= trigger;
    return price < trigger;
  }

  // Auto-execute when trigger is met
  useEffect(() => {
    if (!livePrice || !address) return;
    for (const order of orders) {
      if (executedIds.has(order.orderId) || cancelledIds.has(order.orderId)) continue;
      if (executing === order.orderId) continue;
      if (isTriggerMet(order, livePrice)) {
        handleExecute(order);
        break; // one at a time
      }
    }
  }, [livePrice, orders, executedIds, cancelledIds]);

  async function handleExecute(order: SavedLimitOrder) {
    if (!address || executing) return;
    setExecuting(order.orderId);

    try {
      // Fetch Pyth update data
      const res = await fetch(`${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}&encoding=hex`);
      const data = await res.json();
      const vaaHex = `0x${data.binary.data[0]}` as `0x${string}`;

      const triggerPriceRaw = BigInt(order.triggerPrice);
      const dirValue = order.triggerDir === "ABOVE_OR_EQUAL" ? 0 : 1;

      await writeContractAsync({
        address: SHADOW_LIMIT_ORDER_ADDRESS,
        abi: ShadowLimitOrderABI,
        functionName: "executeOrder",
        args: [
          BigInt(order.orderId),
          [vaaHex],
          order.orderSecret as `0x${string}`,
          BigInt(order.marketId),
          triggerPriceRaw,
          dirValue,
          order.betOutcome,
          BigInt(order.amount),
          BigInt(order.orderNonce),
        ],
        value: 1n, // minimal fee for Pyth update
      });

      setExecutedIds((prev) => new Set([...prev, order.orderId]));
    } catch (e) {
      console.error("Auto-execute failed:", e);
    } finally {
      setExecuting(null);
    }
  }

  async function handleCancel(order: SavedLimitOrder) {
    if (!address) return;
    setCancelling(order.orderId);
    try {
      await writeContractAsync({
        address: SHADOW_LIMIT_ORDER_ADDRESS,
        abi: ShadowLimitOrderABI,
        functionName: "cancelOrder",
        args: [BigInt(order.orderId)],
      });
      setCancelledIds((prev) => new Set([...prev, order.orderId]));
    } catch (e) {
      console.error("Cancel failed:", e);
    } finally {
      setCancelling(null);
    }
  }

  // Filter to active orders only
  const activeOrders = orders.filter(
    (o) => !executedIds.has(o.orderId) && !cancelledIds.has(o.orderId)
  );

  if (!address || activeOrders.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5">
      <h3 className="text-white font-semibold text-sm mb-3">Active Limit Orders</h3>

      <div className="space-y-3">
        {activeOrders.map((order) => {
          const trigger = Number(order.triggerPrice) / 1e8;
          const met = livePrice !== null && isTriggerMet(order, livePrice);
          const progress = livePrice
            ? order.triggerDir === "ABOVE_OR_EQUAL"
              ? Math.min(100, (livePrice / trigger) * 100)
              : Math.min(100, (trigger / livePrice) * 100)
            : 0;

          return (
            <div key={order.orderId} className="rounded-lg border border-zinc-800/40 bg-zinc-950/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                    order.betOutcome === 1 ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10"
                  }`}>
                    {order.betOutcome === 1 ? "YES" : "NO"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {order.triggerDir === "ABOVE_OR_EQUAL" ? "if" : "if"} {asset.symbol} {order.triggerDir === "ABOVE_OR_EQUAL" ? ">=" : "<"} ${trigger.toLocaleString()}
                  </span>
                </div>
                <span className="text-xs text-zinc-400 font-mono">
                  ${(Number(order.amount) / 1e6).toFixed(0)}
                </span>
              </div>

              {/* Progress toward trigger */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${met ? "bg-[#00e87b]" : "bg-zinc-600"}`}
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
                <span className={`text-[11px] font-mono ${met ? "text-[#00e87b]" : "text-zinc-600"}`}>
                  {met ? "Triggered" : livePrice ? `$${livePrice.toFixed(0)}` : "..."}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between">
                {met ? (
                  <span className="text-[11px] text-[#00e87b]">
                    {executing === order.orderId ? "Executing..." : "Auto-executing..."}
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-600">Watching price</span>
                )}
                <button
                  onClick={() => handleCancel(order)}
                  disabled={cancelling === order.orderId || executing === order.orderId}
                  className="text-[11px] text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  {cancelling === order.orderId ? "Cancelling..." : "Cancel"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
