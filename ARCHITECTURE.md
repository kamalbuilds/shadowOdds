# ShadowOdds — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js 16)                       │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐    │
│  │  Market  │  │  Speed   │  │Dashboard │  │   Privacy Suite   │    │
│  │  Detail  │  │ Markets  │  │ (My Bets)│  │ (Unlink wallet,   │    │
│  │          │  │          │  │          │  │  burner, adapter) │    │
│  └────┬─────┘  └────┬─────┘  └───-─┬────┘  └───────-─┬─────────┘    │
│       │             │              │                 │              │
│  ┌────┴─────────────┴──────────────┴─────────────────┴──────────┐   │
│  │                    wagmi v3 + viem                           │   │
│  └────────────────────────────┬─────────────────────────────────┘   │
│                               │                                     │
│  ┌────────────────────────────┴──────────────────────────────────┐  │
│  │                  Unlink SDK (@unlink-xyz/react)               │  │    
│  │  ZK proofs · Burner wallets · Shielded pool · Private sends   │  │
│  └───────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
            ┌───────┴───────┐       ┌───────┴───────┐
            │  Monad Chain  │       │  Pyth Network │
            │  (10143)      │       │  (Hermes)     │
            │               │       │               │
            │ ShadowOdds    │       │ Price feeds:  │
            │ MockUSDC      │       │ ETH, BTC, SOL │
            │ Unlink Pool   │       │ DOGE, MON     │
            └───────────────┘       └───────────────┘
```

---

## Smart Contract Architecture

### ShadowOdds.sol — Core Prediction Market

The central contract managing market lifecycle, betting, resolution, and payouts.

```
┌─────────────────────────────────────────────────┐
│                  ShadowOdds                      │
│                                                  │
│  Storage:                                        │
│  ├── markets: mapping(uint256 => Market)         │
│  ├── bets: mapping(marketId => bettor => Bet)    │
│  ├── marketCount: uint256                        │
│  ├── protocolFeeBps: uint256 (default 100 = 1%)  │
│  └── treasury: address                           │
│                                                  │
│  Market Struct:                                  │
│  ├── question: string                            │
│  ├── bettingDeadline: uint256                    │
│  ├── resolutionTime: uint256                     │
│  ├── oracleType: ADMIN | PRICE_FEED              │
│  ├── priceOracle: address (Pyth)                 │
│  ├── priceFeedId: bytes32                        │
│  ├── threshold: int64                            │
│  ├── resolved: bool                              │
│  ├── result: Outcome                             │
│  ├── totalPool / yesPool / noPool: uint256       │
│  └── creator: address                            │
│                                                  │
│  Bet Struct:                                     │
│  ├── commitment: bytes32 (keccak256 hash)        │
│  ├── amount: uint256                             │
│  ├── revealed: bool                              │
│  ├── outcome: Outcome                            │
│  └── claimed: bool                               │
└─────────────────────────────────────────────────┘
```

### Market Lifecycle

```
CREATE                    BET                    RESOLVE                 REVEAL               CLAIM
  │                        │                       │                      │                     │
  ▼                        ▼                       ▼                      ▼                     ▼
┌──────┐  deadline   ┌──────────┐  resolution  ┌──────────┐          ┌──────────┐         ┌──────────┐
│      │  not yet    │          │  time passed │          │          │          │         │          │
│ Open │────────────▶│ Betting  │─────────────▶│ Pending  │─────────▶│ Reveal   │────────▶│ Settled  │
│      │             │          │              │          │          │          │         │          │
└──────┘             └──────────┘              └──────────┘          └──────────┘         └──────────┘
                     commitments               resolveWithPyth()     revealBet()           claimWinnings()
                     locked                    or resolveAdmin()     secret+nonce          payout sent
                     direction hidden          result set            direction exposed     USDC transferred
```

### Pari-Mutuel Payout Formula

```
Given:
  totalPool = yesPool + noPool
  winnerPool = pool of winning side
  loserPool = pool of losing side
  userStake = individual bet amount

If loserPool == 0:
  payout = userStake  (no losers, return stake)

Otherwise:
  grossWinnings = userStake + (userStake * loserPool / winnerPool)
  profit = grossWinnings - userStake
  fee = profit * protocolFeeBps / 10_000
  netPayout = grossWinnings - fee
```

---

## Commit-Reveal Scheme

The core privacy mechanism that hides bet direction until after resolution.

### Commitment Phase (Before Resolution)

```
Client-side:
  secret  = crypto.getRandomValues(32 bytes)
  nonce   = crypto.getRandomValues(8 bytes)
  outcome = YES (1) or NO (2)
  amount  = bet amount in USDC wei (6 decimals)

  commitment = keccak256(abi.encodePacked(secret, uint8(outcome), amount, nonce))

On-chain call:
  ShadowOdds.placeBet(marketId, commitment, amount)

What's stored:
  bets[marketId][msg.sender] = Bet{commitment, amount, revealed: false}

What observers see:
  "0xcf44...FbD2 placed 100 USDC on market #3"
  (direction unknown — commitment is opaque hash)
```

### Reveal Phase (After Resolution)

```
Client-side:
  Load saved: {secret, nonce, outcome, amount} from localStorage

On-chain call:
  ShadowOdds.revealBet(marketId, secret, outcome, amount, nonce)

Verification:
  computed = keccak256(abi.encodePacked(secret, outcome, amount, nonce))
  require(computed == bets[marketId][msg.sender].commitment)

  If match: bet.revealed = true, pool accounting updated
  If no match: revert (can't lie about direction)
```

### Security Properties

| Property | Guarantee |
|----------|-----------|
| **Hiding** | Commitment reveals nothing about direction (random secret + nonce) |
| **Binding** | Cannot change direction after commitment (keccak256 preimage resistance) |
| **Non-replayable** | Each commitment uses unique secret + nonce |
| **Verifiable** | Anyone can verify reveal matches commitment |

---

## Privacy Architecture (Unlink Integration)

Three privacy layers work together to break the wallet-to-winnings link.

### Layer 1: Commit-Reveal (Direction Privacy)

```
Public:  "Someone bet 100 USDC"
Hidden:  "...on YES" or "...on NO"
When:    Direction revealed only after market resolution
```

### Layer 2: Burner Wallets (Identity Privacy)

```
Main Wallet (0x1234...identity known)
      │
      ▼ deposit USDC
┌─────────────────────────┐
│   Unlink Shielded Pool  │  ← ZK proof: amount deposited, identity shielded
│   (balance: hidden)     │
└────────────┬────────────┘
             │ fund burner (ZK proof)
             ▼
      Burner Wallet (0xcf44...anonymous)
             │
             ▼ placeBet from burner
      ShadowOdds Contract
             │
      On-chain observer sees:
      "0xcf44 bet 100 USDC" — no link to 0x1234
```

### Layer 3: Private Settlement (Withdrawal Privacy)

```
After winning:
      Burner Wallet (0xcf44) holds winnings
             │
             ▼ sweep to pool (ZK proof)
      Unlink Shielded Pool
             │
             ▼ withdraw to any address (ZK proof)
      Fresh Wallet (0xABCD...new address)

Result: No on-chain path from 0x1234 → betting → winning → 0xABCD
```

### Burner Wallet Flow (Implementation)

```
                         ┌──────────────-────┐
                         │  User's Browser   │
                         │  (localStorage)   │
                         └────────┬──────────┘
                                  │
Step 1: createBurner(0)           │ Generates keypair locally
                                  ▼
                         ┌───────────────-───┐
                         │  Burner Wallet    │
                         │  (fresh EOA)      │
                         │  MON: 0 USDC: 0   │
                         └────────┬──────────┘
                                  │
Step 2: fund(USDC, amount)        │ Unlink relay (ZK proof)
                                  ▼
                         ┌───────────────-───┐
                         │  Burner Wallet    │
                         │  MON: 0 USDC: 100 │  ← Has tokens, no gas
                         └────────┬──────────┘
                                  │
Step 3: sendTransaction(MON)      │ Main wallet sends ~0.05 MON for gas
                                  ▼
                         ┌──────────────────-┐
                         │  Burner Wallet    │
                         │  MON: 0.05        │  ← Now has gas
                         │  USDC: 100        │
                         └────────┬──────────┘
                                  │
Step 4: approve + placeBet        │ Two txs from burner
                                  ▼
                         ┌──────────────────┐
                         │  ShadowOdds      │
                         │  Bet recorded    │
                         │  from 0xcf44     │  ← Anonymous bettor
                         └────────┬─────────┘
                                  │
Step 5: sweepToPool(USDC)         │ After claim, ZK sweep
                                  ▼
                         ┌──────────────────┐
                         │  Shielded Pool   │
                         │  (winnings safe) │
                         └──────────────────┘
```

---

## Frontend Architecture

### Component Hierarchy

```
Providers (wagmi + React Query + Unlink)
├── Layout
│   ├── ConnectButton
│   └── Navigation
│
├── Home (/)
│   ├── MarketCard[] ← useReadContract (market data)
│   └── LiveActivityFeed ← useContractEvents (BetPlaced, MarketResolved)
│
├── Market Detail (/market/[id])
│   ├── Market Info + Betting UI
│   │   ├── YES/NO buttons + amount input
│   │   ├── Reveal button (post-resolution)
│   │   └── Claim button (after reveal)
│   │
│   └── Privacy Sidebar
│       ├── PrivateAdapter ← useBurner (anonymous betting flow)
│       ├── UnlinkWallet ← useUnlink, useSend, useWithdraw (shield/transfer)
│       ├── PrivacyScore ← useUnlinkBalance (privacy meter)
│       ├── PrivacyTimeline ← useUnlinkHistory (tx history)
│       └── ShadowReceipt (ZK proof display)
│
├── Speed Markets (/speed)
│   ├── CircularTimer (1/5/15 min countdown)
│   └── Live Pyth price feeds
│
└── Dashboard (/dashboard)
    └── User's bets across all markets
```

### State Management

| Concern | Solution |
|---------|----------|
| Wallet connection | wagmi v3 (`useAccount`, `useConnect`) |
| Contract reads | wagmi `useReadContract` with `refetchInterval` |
| Contract writes | wagmi `useWriteContract` + `useWaitForTransactionReceipt` |
| Privacy state | Unlink SDK hooks (balance, history, burner) |
| Bet commitments | localStorage (secret + nonce per market per wallet) |
| Server state | React Query (via wagmi + Unlink) |
| UI state | React useState (local per component) |

### Key Libraries

```
src/lib/
├── shadowodds.ts    # Commitment generation, localStorage persistence,
│                    # market status logic, USDC formatting
│
└── wagmi.ts         # Chain definitions (Monad testnet/mainnet),
                     # contract addresses, Pyth feed mapping,
                     # wagmi config (MetaMask connector)
```

---

## Oracle Integration (Pyth)

### Price Resolution Flow

```
                    ┌──────────────────┐
                    │  Pyth Hermes     │
                    │  (off-chain)     │
                    │                  │
                    │  Price feeds:    │
                    │  ETH, BTC, SOL   │
                    │  DOGE, MON       │
                    │  (400ms updates) │
                    └────────┬─────────┘
                             │
                    getLatestPriceUpdates()
                             │
                             ▼
                    ┌──────────────────┐
                    │  Frontend        │
                    │  (fetches VAA)   │
                    └────────┬─────────┘
                             │
                    resolveWithPyth(marketId, pythUpdateData)
                             │
                             ▼
                    ┌──────────────────┐
                    │  Pyth Contract   │
                    │  (on-chain)      │
                    │                  │
                    │  1. Pay update   │
                    │     fee          │
                    │  2. Verify VAA   │
                    │  3. Store price  │
                    └────────┬─────────┘
                             │
                    getPriceNoOlderThan(feedId, maxAge)
                             │
                             ▼
                    ┌──────────────────┐
                    │  ShadowOdds      │
                    │                  │
                    │  price >= thresh  │
                    │  ? YES : NO      │
                    │                  │
                    │  market.resolved │
                    │  = true          │
                    └──────────────────┘
```

### Feed Configuration

```solidity
// Market creation with Pyth oracle
createMarket(
  "Will ETH be above $3000 at 6pm?",
  bettingDeadline,     // When betting closes
  resolutionTime,      // When price is checked
  OracleType.PRICE_FEED,
  0x2880...17B43,      // Pyth contract on Monad
  0xff61...0ace,       // ETH/USD feed ID
  300000000000         // $3000.00 (8 decimal precision)
)
```

---

## Data Flow: Complete Bet Lifecycle

```
USER                    FRONTEND                 CHAIN                   PYTH
  │                        │                       │                      │
  │─── Connect wallet ────▶│                       │                      │
  │                        │── useReadContract ────▶│                      │
  │◀── Market list ────────│◀── markets[] ─────────│                      │
  │                        │                       │                      │
  │─── Select YES, $100 ──▶│                       │                      │
  │                        │── createCommitment() ─│                      │
  │                        │   (local, off-chain)  │                      │
  │                        │                       │                      │
  │◀── Sign tx prompt ─────│                       │                      │
  │─── Confirm ────────────▶│── placeBet(commit) ──▶│                      │
  │                        │                       │── Store commitment   │
  │◀── "Bet placed" ───────│◀── tx receipt ────────│                      │
  │                        │                       │                      │
  │        ... time passes (betting deadline) ...  │                      │
  │        ... time passes (resolution time) ...   │                      │
  │                        │                       │                      │
  │                        │── fetch VAA ──────────│──────────────────────▶│
  │                        │◀── price update ──────│◀── signed price ─────│
  │                        │── resolveWithPyth() ──▶│                      │
  │                        │                       │── Compare vs thresh  │
  │                        │◀── resolved: YES ─────│                      │
  │                        │                       │                      │
  │─── Reveal bet ─────────▶│── revealBet(secret) ─▶│                      │
  │                        │                       │── Verify hash match  │
  │                        │                       │── Update pools       │
  │                        │                       │                      │
  │─── Claim ──────────────▶│── claimWinnings() ───▶│                      │
  │                        │                       │── Calculate payout   │
  │                        │                       │── Transfer USDC      │
  │◀── Winnings received ──│◀── tx receipt ────────│                      │
  │                        │                       │                      │
  │─── Shield winnings ────▶│── Unlink deposit ────▶│                      │
  │                        │   (ZK proof)          │── Pool balance up    │
  │◀── Shielded ───────────│◀── relay confirmed ───│                      │
```

---

## Security Considerations

| Risk | Mitigation |
|------|-----------|
| Commitment front-running | 32-byte random secret + 8-byte nonce makes brute-force infeasible |
| Oracle manipulation | Pyth VAA requires multi-publisher consensus; maxAge check prevents stale prices |
| Reentrancy | USDC transfers after state updates; no ETH transfers |
| Fee extraction | Protocol fee capped at 5% (500 bps), only on profits |
| Unclaimed funds | Treasury can sweep unclaimed bets after reasonable period |
| Burner gas linkage | Main wallet sends small MON to burner for gas — minor privacy trade-off for hackathon |

---

## Deployment Architecture

```
Monad Testnet (10143)
├── ShadowOdds ─── Deployed via DeployProduction.s.sol
│   ├── Owner: deployer wallet (market creation, admin resolution)
│   ├── Treasury: receives protocol fees
│   └── USDC: MockUSDC for testnet
│
├── Pyth Oracle ─── Pre-deployed by Pyth Network
│   └── Feeds: ETH, BTC, SOL, DOGE, MON (400ms)
│
├── Unlink Pool ─── Pre-deployed by Unlink
│   ├── Shielded USDC balances
│   ├── Burner wallet infrastructure
│   └── ZK relay service
│
└── Frontend ─── Next.js static + dynamic routes
    ├── Static: /, /speed, /dashboard
    └── Dynamic: /market/[id]
```

---

## Foundry Configuration

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
evm_version = "prague"      # Required for Monad
via_ir = true                # Required for Monad
solc_version = "0.8.28"

[rpc_endpoints]
monad_testnet = "https://testnet-rpc.monad.xyz"
monad_mainnet = "https://rpc.monad.xyz"
```
