import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

const DATA_DIR = process.env.DATA_DIR ?? ".";
const DB_FILE = path.join(DATA_DIR, "agent.json");

interface AgentDB {
  privateKey: string | null;
  bets: Record<string, BetRecord>; // key: "marketId:address"
}

export interface BetRecord {
  market_id: number;
  wallet_address: string;
  secret: string;
  outcome: number;
  amount: string;
  nonce: string;
  commitment: string;
  tx_hash: string | null;
  revealed: number;
  claimed: number;
  created_at: number;
}

function load(): AgentDB {
  if (!fs.existsSync(DB_FILE)) return { privateKey: null, bets: {} };
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as AgentDB;
}

function save(db: AgentDB) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function getOrCreatePrivateKey(): `0x${string}` {
  // Allow injecting via env (useful for testing with a pre-funded wallet)
  const fromEnv = process.env.AGENT_PRIVATE_KEY?.trim();
  if (fromEnv) return fromEnv as `0x${string}`;

  const db = load();
  if (db.privateKey) return db.privateKey as `0x${string}`;
  const key = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  db.privateKey = key;
  save(db);
  return key;
}

function betKey(marketId: number, address: string) {
  return `${marketId}:${address.toLowerCase()}`;
}

export function saveBet(record: Omit<BetRecord, "revealed" | "claimed" | "created_at">) {
  const db = load();
  db.bets[betKey(record.market_id, record.wallet_address)] = {
    ...record,
    wallet_address: record.wallet_address.toLowerCase(),
    revealed: 0,
    claimed: 0,
    created_at: Math.floor(Date.now() / 1000),
  };
  save(db);
}

export function getBet(marketId: number, walletAddress: string): BetRecord | null {
  const db = load();
  return db.bets[betKey(marketId, walletAddress)] ?? null;
}

export function getPendingBets(walletAddress: string): BetRecord[] {
  const db = load();
  return Object.values(db.bets).filter(
    (b) => b.wallet_address === walletAddress.toLowerCase() && b.claimed === 0
  );
}

export function markRevealed(marketId: number, walletAddress: string, txHash: string) {
  const db = load();
  const key = betKey(marketId, walletAddress);
  if (db.bets[key]) {
    db.bets[key].revealed = 1;
    db.bets[key].tx_hash = txHash;
  }
  save(db);
}

export function markClaimed(marketId: number, walletAddress: string, txHash: string) {
  const db = load();
  const key = betKey(marketId, walletAddress);
  if (db.bets[key]) {
    db.bets[key].claimed = 1;
    db.bets[key].tx_hash = txHash;
  }
  save(db);
}
