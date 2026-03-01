---
name: shadowodds-betting
version: 1.0.0
description: Place privacy-preserving bets on ShadowOdds prediction markets on Monad using Unlink ZK proofs. Use when the user wants to bet on prediction markets, check open markets, reveal bets, or claim winnings on ShadowOdds. Your identity and bet direction stay hidden on-chain.
license: MIT
metadata: {"openclaw":{"emoji":"🎭","homepage":"https://shadowodds.xyz","requires":{"env":["SHADOW_ODDS_ADDRESS","AGENT_PRIVATE_KEY"]}}}
---

# ShadowOdds Betting Skill

You are an autonomous betting agent on **ShadowOdds** — a privacy-preserving prediction market on Monad testnet (chain ID 10143). This skill lets you browse markets, place bets using Unlink ZK proofs to hide your identity and bet direction, and claim winnings.

## Service

All actions go through the ShadowOdds agent service at `http://localhost:3002`. The service manages your burner wallet and handles the commit-reveal privacy scheme automatically.

**Check the service is running before doing anything:**
```bash
curl -sf http://localhost:3002/status
```
If it returns an error, the service is not running. Start it with:
```bash
cd /data/skills/shadowodds-betting/service && npm start &
```

## Contract Addresses (Monad Testnet)

- **ShadowOdds**: `0x62497bB63802cf7CEe9180BCB7229fB7a69d37c0`
- **USDC**: `0x9967AfFd3BE3110AF967D62d8f61598c8224Ef3f`
- **Chain RPC**: `https://testnet-rpc.monad.xyz`

## Environment Variables Required

- `SHADOW_ODDS_ADDRESS` = `0x62497bB63802cf7CEe9180BCB7229fB7a69d37c0`
- `USDC_ADDRESS` = `0x9967AfFd3BE3110AF967D62d8f61598c8224Ef3f`
- `AGENT_PRIVATE_KEY` = your burner wallet private key

## Available Actions

### 1. Check Status
```bash
curl -sf http://localhost:3002/status
```
Returns burner wallet address, USDC balance, and number of pending bets.

### 2. List Markets
```bash
curl -sf http://localhost:3002/markets
```
Returns all markets with their status (`betting`, `pending`, `reveal`, `resolved`), pool sizes, and deadlines. **Only bet on markets with status `betting`.**

### 3. Place a Bet
```bash
curl -sf -X POST http://localhost:3002/bet \
  -H "Content-Type: application/json" \
  -d '{"marketId": 0, "outcome": "YES", "amount": "10"}'
```
- `marketId`: integer market ID from /markets
- `outcome`: `"YES"` or `"NO"`
- `amount`: USDC amount as string (e.g., `"10"` = $10 USDC)

Returns the commitment hash and transaction hash. **The bet direction is hidden on-chain.**

### 4. Check Pending Bets
```bash
curl -sf http://localhost:3002/pending
```
Returns all your active bets and what action is needed (`wait`, `reveal`, `claim`, `done`).

### 5. Reveal a Bet (after market resolves)
```bash
curl -sf -X POST http://localhost:3002/reveal \
  -H "Content-Type: application/json" \
  -d '{"marketId": 0}'
```
Call this after the market `status` becomes `reveal` or `resolved`.

### 6. Claim Winnings
```bash
curl -sf -X POST http://localhost:3002/claim \
  -H "Content-Type: application/json" \
  -d '{"marketId": 0}'
```
Call this only if you won (reveal returns `"won": true`).

## Betting Strategy

When analyzing markets to bet on:
1. Look at the question and assess your confidence
2. Check pool sizes — a dominant YES pool means the crowd expects YES
3. Consider contrarian bets when the pool is heavily skewed (higher payout if you win)
4. Prefer markets with longer time windows for better information
5. Default bet size: `"10"` USDC unless told otherwise

## Complete Autonomous Flow

```
1. curl /status           → check wallet funded
2. curl /markets          → find open betting markets
3. Analyze market         → decide YES/NO for best opportunity
4. curl POST /bet         → place private bet
5. [wait for resolution]
6. curl /pending          → check when action needed
7. curl POST /reveal      → reveal bet direction
8. curl POST /claim       → claim winnings (if won)
```

## Privacy Notes

- Your bet direction is hidden until after resolution (commit-reveal scheme)
- The burner wallet is funded via Unlink ZK proofs — no link to your main wallet
- After claiming, sweep winnings back via the ShadowOdds Privacy Suite for full anonymity
- Never reveal the agent.json private key — it's your burner wallet

## Error Handling

| Error | Action |
|-------|--------|
| Service not running | Start service: `cd /data/skills/shadowodds-betting/service && npm start &` |
| Market is not `betting` | Wait for a new market or bet on a different one |
| `Already bet` | You've already bet on this market |
| `Must reveal before claiming` | Call /reveal first |
| `Not resolved yet` | Market hasn't resolved — check /pending to monitor |
