import { keccak256, encodePacked, parseUnits, formatUnits } from "viem";
import { randomBytes } from "crypto";

export enum Outcome {
  PENDING = 0,
  YES = 1,
  NO = 2,
}

export enum OracleType {
  ADMIN = 0,
  PRICE_FEED = 1,
}

export interface Market {
  id: number;
  question: string;
  bettingDeadline: bigint;
  resolutionTime: bigint;
  revealDeadline: bigint;
  oracleType: OracleType;
  priceOracle: string;
  priceFeedId: string;
  priceThreshold: bigint;
  result: Outcome;
  resolved: boolean;
  totalPool: bigint;
  yesPool: bigint;
  noPool: bigint;
}

export interface BetCommitment {
  secret: `0x${string}`;
  outcome: Outcome;
  amount: bigint;
  nonce: bigint;
  commitment: `0x${string}`;
  viaAdapter?: boolean;
}

/** Generate a random secret + compute commitment hash */
export function createCommitment(outcome: Outcome, amountUsdc: string): BetCommitment {
  const secret = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const nonce = BigInt(`0x${randomBytes(8).toString("hex")}`);
  const amount = parseUnits(amountUsdc, 6); // USDC has 6 decimals

  const commitment = keccak256(
    encodePacked(["bytes32", "uint8", "uint256", "uint256"], [secret, outcome, amount, nonce])
  );

  return { secret, outcome, amount, nonce, commitment };
}

/** Persist commitment to localStorage — keyed by commitment hash for V2 */
export function saveCommitment(marketId: number, bettor: string, bet: BetCommitment) {
  // Primary key: commitment hash (V2 — commitment-keyed)
  const commitKey = `shadowodds:bet:${marketId}:commitment:${bet.commitment}`;
  localStorage.setItem(commitKey, JSON.stringify({
    ...bet,
    amount: bet.amount.toString(),
    nonce: bet.nonce.toString(),
    bettor: bettor.toLowerCase(),
  }));

  // Index: list of commitment hashes per bettor per market
  const listKey = `shadowodds:bets:${marketId}:${bettor.toLowerCase()}`;
  const existing = JSON.parse(localStorage.getItem(listKey) || "[]") as string[];
  if (!existing.includes(bet.commitment)) {
    existing.push(bet.commitment);
    localStorage.setItem(listKey, JSON.stringify(existing));
  }

  // Legacy key for backward compat (single bet per address — keep for migration)
  const legacyKey = `shadowodds:bet:${marketId}:${bettor.toLowerCase()}`;
  localStorage.setItem(legacyKey, JSON.stringify({
    ...bet,
    amount: bet.amount.toString(),
    nonce: bet.nonce.toString(),
  }));
}

/** Load the first saved commitment for a bettor on a market */
export function loadCommitment(marketId: number, bettor: string): BetCommitment | null {
  // Try new commitment-keyed index first
  const listKey = `shadowodds:bets:${marketId}:${bettor.toLowerCase()}`;
  const commitments = JSON.parse(localStorage.getItem(listKey) || "[]") as string[];
  if (commitments.length > 0) {
    const first = loadCommitmentByHash(marketId, commitments[0]);
    if (first) return first;
  }

  // Fallback to legacy key
  const legacyKey = `shadowodds:bet:${marketId}:${bettor.toLowerCase()}`;
  const raw = localStorage.getItem(legacyKey);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return { ...parsed, amount: BigInt(parsed.amount), nonce: BigInt(parsed.nonce) };
}

/** Load all commitments for a bettor on a market */
export function loadAllCommitments(marketId: number, bettor: string): BetCommitment[] {
  const listKey = `shadowodds:bets:${marketId}:${bettor.toLowerCase()}`;
  const commitments = JSON.parse(localStorage.getItem(listKey) || "[]") as string[];
  return commitments
    .map((hash) => loadCommitmentByHash(marketId, hash))
    .filter(Boolean) as BetCommitment[];
}

/** Load a specific commitment by its hash */
export function loadCommitmentByHash(marketId: number, commitmentHash: string): BetCommitment | null {
  const key = `shadowodds:bet:${marketId}:commitment:${commitmentHash}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    amount: BigInt(parsed.amount),
    nonce: BigInt(parsed.nonce),
    viaAdapter: parsed.viaAdapter ?? false,
  };
}

/** Format USDC (6 decimals) to human-readable */
export function formatUSDC(amount: bigint): string {
  return `$${parseFloat(formatUnits(amount, 6)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Time remaining until deadline */
export function timeRemaining(deadline: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) return "Closed";
  const secs = Number(deadline - now);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

export function outcomeLabel(o: Outcome): string {
  return o === Outcome.YES ? "YES" : o === Outcome.NO ? "NO" : "PENDING";
}

export function marketStatus(m: Market): "betting" | "pending" | "resolved" | "reveal" {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (m.resolved && now >= m.revealDeadline) return "resolved";
  if (m.resolved) return "reveal";
  if (now >= m.bettingDeadline) return "pending";
  return "betting";
}

// ─────────────────────── Yield Helpers ───────────────────────

const SECONDS_PER_YEAR = 365 * 24 * 3600;
const APR_BPS = 500; // 5%

/** Client-side yield estimate for display (matches YieldVault.sol logic) */
export function calculateEstimatedYield(totalPoolUsdc: bigint, depositTimestamp: number): {
  yieldUsdc: bigint;
  aprPercent: number;
  durationSeconds: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const duration = Math.max(0, now - depositTimestamp);
  // yield = totalPool * 500 * duration / (10000 * SECONDS_PER_YEAR)
  const yieldUsdc = (totalPoolUsdc * BigInt(APR_BPS) * BigInt(duration)) / (10000n * BigInt(SECONDS_PER_YEAR));
  return { yieldUsdc, aprPercent: APR_BPS / 100, durationSeconds: duration };
}

// ─────────────────────── Limit Order Helpers ───────────────────────

export type TriggerDirection = "ABOVE_OR_EQUAL" | "BELOW";

export interface LimitOrderCommitments {
  orderSecret: `0x${string}`;
  orderNonce: bigint;
  orderCommitment: `0x${string}`;
  betSecret: `0x${string}`;
  betNonce: bigint;
  betCommitment: `0x${string}`;
}

/** Generate both order commitment (hides trigger) and bet commitment for ShadowOddsV2 */
export function createLimitOrderCommitment(
  marketId: number,
  triggerPrice: bigint,
  triggerDir: TriggerDirection,
  betOutcome: Outcome,
  amountUsdc: string,
  keeperRewardBps: number,
): LimitOrderCommitments {
  const amount = parseUnits(amountUsdc, 6);
  const keeperReward = (amount * BigInt(keeperRewardBps)) / 10000n;
  const betAmount = amount - keeperReward;

  const orderSecret = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const orderNonce = BigInt(`0x${randomBytes(8).toString("hex")}`);
  const dirValue = triggerDir === "ABOVE_OR_EQUAL" ? 0 : 1;

  const orderCommitment = keccak256(
    encodePacked(
      ["bytes32", "uint256", "int64", "uint8", "uint8", "uint256", "uint256"],
      [orderSecret, BigInt(marketId), triggerPrice, dirValue, betOutcome, amount, orderNonce]
    )
  );

  const betSecret = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const betNonce = BigInt(`0x${randomBytes(8).toString("hex")}`);
  const betCommitment = keccak256(
    encodePacked(
      ["bytes32", "uint8", "uint256", "uint256"],
      [betSecret, betOutcome, betAmount, betNonce]
    )
  );

  return { orderSecret, orderNonce, orderCommitment, betSecret, betNonce, betCommitment };
}

export interface SavedLimitOrder {
  orderId: number;
  marketId: number;
  triggerPrice: string;
  triggerDir: TriggerDirection;
  betOutcome: Outcome;
  amount: string;
  keeperRewardBps: number;
  orderSecret: string;
  orderNonce: string;
  betSecret: string;
  betNonce: string;
  expiry: number;
  createdAt: number;
}

export function saveLimitOrder(creator: string, order: SavedLimitOrder) {
  const key = `shadowodds:limitorder:${creator.toLowerCase()}:${order.orderId}`;
  localStorage.setItem(key, JSON.stringify(order));
  // Also track list of order IDs
  const listKey = `shadowodds:limitorders:${creator.toLowerCase()}`;
  const existing = JSON.parse(localStorage.getItem(listKey) || "[]") as number[];
  if (!existing.includes(order.orderId)) {
    existing.push(order.orderId);
    localStorage.setItem(listKey, JSON.stringify(existing));
  }
}

export function loadLimitOrder(creator: string, orderId: number): SavedLimitOrder | null {
  const key = `shadowodds:limitorder:${creator.toLowerCase()}:${orderId}`;
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

export function loadAllLimitOrders(creator: string): SavedLimitOrder[] {
  const listKey = `shadowodds:limitorders:${creator.toLowerCase()}`;
  const ids = JSON.parse(localStorage.getItem(listKey) || "[]") as number[];
  return ids.map((id) => loadLimitOrder(creator, id)).filter(Boolean) as SavedLimitOrder[];
}
