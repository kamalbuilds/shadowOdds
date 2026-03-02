# ShadowOdds

**The first private prediction market on EVM with Openclaw Agents Betting.**

Bet privately. Win privately. Withdraw privately. Built on Monad + Unlink.

---

## The Problem

Polymarket does a billion dollars a week. Every single bet is public your wallet, your direction, your size. Tools exist to stalk whale positions in real time. This creates two critical problems:

1. **Institutional lockout** -  No fund manager will take a public position that competitors can front-run
2. **Insider exploitation** - If you know something, the chain knows you know

## The Solution

ShadowOdds uses a three-layer privacy model to make prediction markets actually private:

| Layer | What's Hidden | How |
|-------|---------------|-----|
| **Commit-Reveal** | Bet direction (YES/NO) | keccak256 commitment; direction revealed only after resolution |
| **Burner Wallets** | Bettor identity | Unlink ZK shielded pool funds anonymous burner wallets |
| **Private Settlement** | Winner identity & payout | Winnings swept back to shielded pool, withdrawn to any address |

**What's public:** Bet amounts, total pool size, market questions, resolution outcomes.
**What's private:** Who bet what direction, who won, how much they won, where winnings went.

---

## Live Deployment

Deployed on **Monad Testnet** (Chain ID: 10143).

| Contract | Address |
|----------|---------|
| ShadowOdds | `0x62497bB63802cf7CEe9180BCB7229fB7a69d37c0` |
| MockUSDC | `0x9967AfFd3BE3110AF967D62d8f61598c8224Ef3f` |
| Pyth Oracle | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| Unlink Pool | `0x0813da0a10328e5ed617d37e514ac2f6fa49a254` |

**7 live markets:** ETH/USD x2, BTC/USD x2, SOL/USD, DOGE/USD, admin event market.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.28, Foundry, OpenZeppelin |
| Oracle | Pyth Network (400ms price feeds) |
| Privacy | Unlink SDK (ZK proofs, burner wallets, shielded pools) |
| Frontend | Next.js 16, React 19, wagmi v3, viem, TailwindCSS v4 |
| Chain | Monad (10,000 TPS, 400ms blocks, EVM-compatible) |
| Settlement | USDC (6 decimals) |

---

## Features

### Prediction Markets
- **Price Markets** — Will ETH/BTC/SOL/DOGE be above X at time Y? Resolved trustlessly via Pyth oracle
- **Admin Markets** — Custom event markets resolved by contract owner
- **Speed Markets** — 1/5/15-minute fast-resolution markets for high-frequency trading
- **Pari-mutuel payouts** — Winners split the loser pool proportionally (1% protocol fee)

### Privacy
- **Commit-reveal betting** — Direction hidden behind keccak256 hash until post-resolution reveal
- **Anonymous burner wallets** — Fund a burner from Unlink's shielded pool, bet from burner, sweep back
- **Shielded withdrawals** — Break the wallet-to-winnings link with ZK proofs
- **No identity exposure** — On-chain observers see amounts but never know who bet which direction

### UX
- **Live activity feed** — Real-time on-chain event stream (BetPlaced, MarketResolved)
- **Dashboard** — Track your bets, reveal, claim winnings across all markets
- **Privacy score** — Visual indicator of how well your privacy setup is configured
- **One-click anonymous betting** — Create burner, fund, bet in a guided flow

---

## Project Structure

```
shadowodds/
├── contracts/                    # Solidity smart contracts (Foundry)
│   ├── src/
│   │   ├── ShadowOdds.sol        # Core prediction market (commit-reveal, pari-mutuel)
│   │   ├── PrivateSettlement.sol  # Commitment/nullifier private payments
│   │   ├── AgentRegistry.sol     # AI agent registration
│   │   ├── AgentVault.sol        # Agent USDC custody
│   │   ├── x402Verifier.sol      # EIP-3009 payment settlement
│   │   ├── interfaces/           # IPyth, IERC20
│   │   └── mocks/                # MockPyth, MockUSDC
│   ├── script/                   # Deploy & utility scripts
│   ├── test/                     # Forge tests
│   └── foundry.toml
│
├── frontend/                     # Next.js web application
│   ├── src/
│   │   ├── app/                  # Pages: home, market/[id], speed, dashboard
│   │   ├── components/           # React components (10 total)
│   │   └── lib/                  # Core logic: shadowodds.ts, wagmi.ts
│   └── package.json
│
├── ARCHITECTURE.md               # System design & data flows
├── PRD.md                        # Product requirements document
├── DEMO_SCRIPT.md                # 6-minute judge demo walkthrough
└── README.md                     # This file
```

---

## How It Works

### 1. Place a Bet (Hidden)
```
You choose: YES on "ETH > $3000"
Client generates: secret + nonce
Client computes:  commitment = keccak256(secret || YES || amount || nonce)
On-chain stores:  commitment + locked USDC
Visible to all:   "Someone bet 100 USDC on market #3"
Hidden:           "...but nobody knows if they bet YES or NO"
```

### 2. Market Resolves (Trustless)
```
Pyth oracle provides price feed → contract checks threshold
Result: YES (price was above target)
Anyone can call resolveWithPyth() — permissionless
```

### 3. Reveal & Claim (Direction Exposed)
```
Winner reveals: secret + nonce + direction
Contract verifies: keccak256 matches stored commitment
Payout: stake + proportional share of loser pool - 1% fee
```

### 4. Shield Winnings (Privacy)
```
Winnings (in USDC) → Unlink shielded pool (ZK proof)
Shielded balance → Withdraw to any wallet
Result: No on-chain link between betting wallet and withdrawal
```
---

## Quick Start

### Prerequisites
- [Foundry](https://getfoundry.sh/) (for contracts)
- [Bun](https://bun.sh/) (for frontend)
- A wallet with MON (Monad testnet native token)

### Contracts

```bash
cd contracts

# Install dependencies
forge install

# Build
forge build

# Test
forge test

# Deploy to Monad testnet
cp .env.example .env
# Fill in PRIVATE_KEY and TREASURY_ADDRESS
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.monad.xyz \
  --broadcast
```

### Frontend

```bash
cd frontend

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Set NEXT_PUBLIC_SHADOW_ODDS_ADDRESS from deploy output

# Run dev server
bun dev

# Build for production
bun run build
```

### Environment Variables

**Frontend `.env`:**
```
NEXT_PUBLIC_SHADOW_ODDS_ADDRESS=0x62497bB63802cf7CEe9180BCB7229fB7a69d37c0
NEXT_PUBLIC_USDC_ADDRESS=0x9967AfFd3BE3110AF967D62d8f61598c8224Ef3f
NEXT_PUBLIC_PYTH_ADDRESS=0x2880aB155794e7179c9eE2e38200202908C17B43
```
---

## Hackathon Tracks

| Track | Relevance |
|-------|-----------|
| **DeFi** | First private prediction market — commit-reveal + pari-mutuel on EVM |
| **Stablecoin** | All settlement in USDC; privacy for stablecoin holders |
| **Wildcard** | Novel ZK+oracle combination; burner wallet anonymous betting |

---

## Pyth Price Feeds

| Asset | Feed ID |
|-------|---------|
| ETH/USD | `0xff61...0ace` |
| BTC/USD | `0xe62d...5b43` |
| SOL/USD | `0xef0d...b56d` |
| DOGE/USD | `0xdcef...d25c` |
| MON/USD | `0x3149...6cd1` |

All feeds use exponent -8 (8 decimal places of precision).

---

### OpenClaw ShadowOdds Betting Skill             
                                                                                        
  A complete OpenClaw skill at openclaw-shadowodds/ that lets agents autonomously place privacy-preserving bets on ShadowOdds
  markets:

  openclaw-shadowodds/
  
  ├── SKILL.md           ← OpenClaw agent instructions
  ├── scripts/           ← Shell scripts for manual testing
  └── service/           ← Express backend (TypeScript)
      ├── index.ts       ← REST API (6 endpoints)
      ├── chain.ts       ← Viem contract interactions
      └── db.ts          ← JSON file persistence

  API endpoints: /status, /markets, /bet, /pending, /reveal, /claim

  Live test on EC2

  - Service deployed inside agentmarket-openclaw Docker container on 52.91.198.101
  - 14 markets read live from Monad testnet
  - Real bet placed on-chain: 25 USDC YES on market #4 ("Will BTC hit $100,000 in 48 hours?")
  - Tx: 0x45621c0c80f0db1ffd991f2ee9351f4b30b260d2478fdc14b16b0bd0a8b16cf2
  - Bet direction hidden via commit-reveal — on-chain observers only see a commitment hash

  How agents use it

  OpenClaw agents read the SKILL.md and use curl to call the service — they can fetch markets, pick the best opportunity, place a
  private bet, and auto-reveal/claim when resolved. The whole flow requires zero human interaction.

---

## License

MIT
