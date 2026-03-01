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

/** Persist commitment to localStorage so user can reveal later */
export function saveCommitment(marketId: number, bettor: string, bet: BetCommitment) {
  const key = `shadowodds:bet:${marketId}:${bettor.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify({ ...bet, amount: bet.amount.toString(), nonce: bet.nonce.toString() }));
}

/** Load saved commitment from localStorage */
export function loadCommitment(marketId: number, bettor: string): BetCommitment | null {
  const key = `shadowodds:bet:${marketId}:${bettor.toLowerCase()}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return { ...parsed, amount: BigInt(parsed.amount), nonce: BigInt(parsed.nonce) };
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
