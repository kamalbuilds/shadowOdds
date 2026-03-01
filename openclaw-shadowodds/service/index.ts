import express from "express";
import { getOrCreatePrivateKey, saveBet, getBet, getPendingBets, markRevealed, markClaimed } from "./db.js";
import {
  createClients,
  getMarkets,
  generateCommitment,
  getUsdcBalance,
  placeBet,
  revealBet,
  claimWinnings,
  getOnChainBet,
  formatUnits,
  parseUnits,
} from "./chain.js";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT ?? "3002", 10);
const SERVICE_URL = process.env.SHADOWODDS_SERVICE_URL ?? `http://localhost:${PORT}`;

// Bootstrap wallet + clients on startup
const privateKey = getOrCreatePrivateKey();
const { account, publicClient, walletClient } = createClients(privateKey);

console.log(`\nShadowOdds Agent Service`);
console.log(`Burner wallet: ${account.address}`);
console.log(`Service:       ${SERVICE_URL}`);
console.log(`Contract:      ${process.env.SHADOW_ODDS_ADDRESS ?? "(not set — set SHADOW_ODDS_ADDRESS)"}\n`);

// ─── GET /status ──────────────────────────────────────────────────────────────
app.get("/status", async (_req, res) => {
  try {
    const usdcBalance = await getUsdcBalance(publicClient, account.address);
    const monBalance = await publicClient.getBalance({ address: account.address });
    const pending = getPendingBets(account.address);

    res.json({
      ok: true,
      address: account.address,
      balance: {
        usdc: usdcBalance,
        mon: formatUnits(monBalance, 18),
      },
      pendingBets: pending.length,
      contract: process.env.SHADOW_ODDS_ADDRESS ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /markets ─────────────────────────────────────────────────────────────
app.get("/markets", async (_req, res) => {
  try {
    const markets = await getMarkets(publicClient);
    const now = BigInt(Math.floor(Date.now() / 1000));

    const formatted = markets.map((m) => ({
      id: m.id,
      question: m.question,
      status: m.status,
      bettingDeadline: new Date(Number(m.bettingDeadline) * 1000).toISOString(),
      resolutionTime: new Date(Number(m.resolutionTime) * 1000).toISOString(),
      totalPool: formatUnits(m.totalPool, 6),
      yesPool: formatUnits(m.yesPool, 6),
      noPool: formatUnits(m.noPool, 6),
      result: m.result === 1 ? "YES" : m.result === 2 ? "NO" : "PENDING",
      resolved: m.resolved,
      secondsLeft: m.status === "betting" ? Number(m.bettingDeadline - now) : 0,
    }));

    res.json({ ok: true, markets: formatted });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /bet ────────────────────────────────────────────────────────────────
// Body: { marketId: number, outcome: "YES"|"NO", amount: string }
app.post("/bet", async (req, res) => {
  const { marketId, outcome: outcomeStr, amount } = req.body as {
    marketId: number;
    outcome: string;
    amount: string;
  };

  if (marketId === undefined || !outcomeStr || !amount) {
    return res.status(400).json({ ok: false, error: "marketId, outcome (YES|NO), and amount required" });
  }

  const outcome = outcomeStr.toUpperCase() === "YES" ? 1 : outcomeStr.toUpperCase() === "NO" ? 2 : null;
  if (!outcome) {
    return res.status(400).json({ ok: false, error: "outcome must be YES or NO" });
  }

  // Check existing bet
  const existing = getBet(marketId, account.address);
  if (existing) {
    return res.status(409).json({ ok: false, error: `Already bet on market ${marketId}`, bet: existing });
  }

  try {
    const markets = await getMarkets(publicClient);
    const market = markets.find((m) => m.id === Number(marketId));

    if (!market) return res.status(404).json({ ok: false, error: "Market not found" });
    if (market.status !== "betting")
      return res.status(400).json({ ok: false, error: `Market is ${market.status}, not open for betting` });

    const { secret, nonce, amount: amountWei, commitment } = generateCommitment(outcome, amount);

    const txHash = await placeBet(publicClient, walletClient as any, Number(marketId), commitment, amountWei);

    saveBet({
      market_id: Number(marketId),
      wallet_address: account.address,
      secret,
      outcome,
      amount: amountWei.toString(),
      nonce: nonce.toString(),
      commitment,
      tx_hash: txHash,
    });

    res.json({
      ok: true,
      marketId: Number(marketId),
      outcome: outcomeStr.toUpperCase(),
      amount,
      commitment,
      txHash,
      note: "Bet placed privately. Run /reveal after the market resolves.",
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /pending ──────────────────────────────────────────────────────────────
app.get("/pending", async (_req, res) => {
  try {
    const bets = getPendingBets(account.address);
    const markets = await getMarkets(publicClient);

    const enriched = bets.map((bet) => {
      const market = markets.find((m) => m.id === bet.market_id);
      return {
        marketId: bet.market_id,
        question: market?.question ?? "Unknown",
        status: market?.status ?? "unknown",
        outcome: bet.outcome === 1 ? "YES" : "NO",
        amount: formatUnits(BigInt(bet.amount), 6),
        revealed: bet.revealed === 1,
        claimed: bet.claimed === 1,
        action:
          bet.claimed === 1
            ? "done"
            : bet.revealed === 1
            ? "claim"
            : market?.status === "reveal" || market?.status === "resolved"
            ? "reveal"
            : "wait",
      };
    });

    res.json({ ok: true, bets: enriched });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /reveal ──────────────────────────────────────────────────────────────
// Body: { marketId: number }
app.post("/reveal", async (req, res) => {
  const { marketId } = req.body as { marketId: number };
  if (marketId === undefined) return res.status(400).json({ ok: false, error: "marketId required" });

  const bet = getBet(Number(marketId), account.address);
  if (!bet) return res.status(404).json({ ok: false, error: `No bet found for market ${marketId}` });
  if (bet.revealed) return res.status(400).json({ ok: false, error: "Already revealed" });

  try {
    const markets = await getMarkets(publicClient);
    const market = markets.find((m) => m.id === Number(marketId));

    if (!market) return res.status(404).json({ ok: false, error: "Market not found" });
    if (!market.resolved)
      return res.status(400).json({ ok: false, error: "Market not resolved yet — cannot reveal" });

    const txHash = await revealBet(
      publicClient,
      walletClient as any,
      Number(marketId),
      bet.secret as `0x${string}`,
      bet.outcome,
      BigInt(bet.amount),
      BigInt(bet.nonce)
    );

    markRevealed(Number(marketId), account.address, txHash);

    const outcomeLabel = bet.outcome === 1 ? "YES" : "NO";
    const marketResult = market.result === 1 ? "YES" : market.result === 2 ? "NO" : "PENDING";
    const won = outcomeLabel === marketResult;

    res.json({
      ok: true,
      marketId: Number(marketId),
      txHash,
      yourOutcome: outcomeLabel,
      marketResult,
      won,
      nextAction: won ? `POST /claim with { marketId: ${marketId} }` : "No winnings to claim",
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /claim ───────────────────────────────────────────────────────────────
// Body: { marketId: number }
app.post("/claim", async (req, res) => {
  const { marketId } = req.body as { marketId: number };
  if (marketId === undefined) return res.status(400).json({ ok: false, error: "marketId required" });

  const bet = getBet(Number(marketId), account.address);
  if (!bet) return res.status(404).json({ ok: false, error: `No bet found for market ${marketId}` });
  if (bet.claimed) return res.status(400).json({ ok: false, error: "Already claimed" });
  if (!bet.revealed) return res.status(400).json({ ok: false, error: "Must reveal before claiming" });

  try {
    const txHash = await claimWinnings(publicClient, walletClient as any, Number(marketId));
    markClaimed(Number(marketId), account.address, txHash);

    const newBalance = await getUsdcBalance(publicClient, account.address);

    res.json({
      ok: true,
      marketId: Number(marketId),
      txHash,
      newUsdcBalance: newBalance,
      note: "Winnings claimed. Run POST /sweep to move funds back to Unlink pool.",
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /address ──────────────────────────────────────────────────────────────
app.get("/address", (_req, res) => {
  res.json({ ok: true, address: account.address });
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
