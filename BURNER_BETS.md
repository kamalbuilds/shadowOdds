# Burner Wallet Betting — How It Works

ShadowOdds offers two ways to bet: **normal bets** (from your connected wallet) and **anonymous burner bets** (from a disposable wallet funded by Unlink's ZK shielded pool). This document explains the burner wallet flow end-to-end.

---

## Why Burner Wallets?

Normal bets use commit-reveal to hide your **direction** (YES/NO), but your **wallet address** is still visible on-chain. Anyone can see that `0xABC...` placed a bet on market #3.

Burner wallets add **identity privacy**:

| | Normal Bet | Burner Bet |
|---|---|---|
| Direction hidden? | Yes (commit-reveal) | Yes (commit-reveal) |
| Identity hidden? | No — your wallet is visible | Yes — burner has no link to you |
| Winnings traceable? | Yes — claimed to your wallet | No — swept to shielded pool |
| Privacy layers | 1 | 3 |

---

## The Three Privacy Layers

```
Layer 1: Commit-Reveal
  Your bet direction (YES/NO) is hidden behind a keccak256 hash.
  On-chain observers see: "Someone bet 50 USDC" — not which side.

Layer 2: Burner Wallet
  The "someone" is a burner address funded from Unlink's ZK shielded pool.
  No on-chain link between your real wallet and the burner.

Layer 3: Shielded Settlement
  After claiming winnings, the burner sweeps USDC back into the shielded pool.
  You withdraw from the pool to any wallet you choose. Link broken.
```

---

## Full Lifecycle

### Step 1: Create Burner Wallet

The user clicks **"Create Burner Wallet"** in the anonymous betting panel. This calls Unlink's `createBurner(0)` — generating a fresh Ethereum keypair locally. The private key never leaves the browser.

```
Frontend: useBurner().createBurner(0)
Result:   burners[0] = { address: "0xBURNER..." }
```

The burner is reusable across markets (index 0). One burner per user session.

### Step 2: Fund Burner from Shielded Pool

The user enters a bet amount (e.g. 50 USDC) and clicks **"Fund from Shielded Pool"**. This transfers USDC from the user's Unlink private balance to the burner wallet — using ZK proofs so the funding source is invisible.

```
Frontend: burnerFund.execute({ index: 0, params: { token: USDC, amount: 50e6 } })
On-chain: Unlink pool → 50 USDC → 0xBURNER
Privacy:  No link between user's wallet and 0xBURNER
```

### Step 3: Auto-Fund Gas (MON)

The burner needs native MON tokens for gas. The frontend automatically checks the burner's MON balance and sends 0.05 MON from the connected wallet if the balance is below 0.01 MON.

```
Frontend: sendTransactionAsync({ to: burnerAddress, value: 0.05 MON })
Note:     This is the only on-chain link — mitigated by the small, fixed amount
```

### Step 4: Place Bet (Commit)

The frontend generates a **commitment** — a keccak256 hash of `(secret, direction, amount, nonce)` — and sends it from the burner wallet.

```
1. Generate commitment:
   secret  = random 32 bytes
   nonce   = random 8 bytes
   hash    = keccak256(secret || YES || 50e6 || nonce)

2. Approve USDC spend (from burner):
   burnerSend.execute({ tx: { to: USDC, data: approve(ShadowOdds, 50e6) } })

3. Place bet (from burner):
   burnerSend.execute({ tx: { to: ShadowOdds, data: placeBet(marketId, hash, 50e6) } })

4. Save commitment to localStorage:
   key: "shadowodds:bet:{marketId}:{burnerAddress}"
   value: { secret, outcome, amount, nonce, commitment }
```

**What's on-chain after this step:**
```
bets[marketId][0xBURNER] = {
  commitment: 0xABC123...,  // opaque hash
  amount: 50 USDC,          // visible
  revealed: false
}
```

An observer sees: *"0xBURNER bet 50 USDC on market #3"* — but doesn't know:
- That 0xBURNER belongs to you
- Whether 0xBURNER bet YES or NO

### Step 5: Market Resolves

The market resolves via Pyth oracle (price markets) or admin (event markets). Anyone can call `resolveWithPyth()` — it's permissionless.

```
ShadowOdds.resolveWithPyth(marketId, pythUpdateData)
→ market.resolved = true
→ market.result = YES (or NO)
```

### Step 6: Reveal Bet (from Burner)

After resolution, the user reveals their bet direction. **This must come from the burner wallet** because the contract checks `msg.sender` to match the bet.

```
Frontend: burnerSend.execute({
  tx: {
    to: ShadowOdds,
    data: revealBet(marketId, secret, outcome, amount, nonce)
  }
})

Contract verifies:
  keccak256(secret || outcome || amount || nonce) == stored commitment
  msg.sender == original bettor (0xBURNER)
```

If verification passes, the bet direction is recorded and the user becomes eligible for payout (if they bet the winning side).

### Step 7: Claim Winnings (from Burner)

If the revealed direction matches the market result, the user claims their payout. Again, **from the burner wallet**.

```
Frontend: burnerSend.execute({
  tx: { to: ShadowOdds, data: claimWinnings(marketId) }
})

Payout formula (pari-mutuel):
  payout = stake + (stake / winnerPool) * loserPool * 0.99
  The 1% fee goes to the protocol treasury.

USDC lands in: 0xBURNER
```

### Step 8: Sweep Winnings to Shielded Pool

The user sweeps all USDC from the burner back into Unlink's shielded pool — breaking the on-chain link between the bet and the winnings.

```
Frontend: burnerSweep.execute({ index: 0, params: { token: USDC } })

On-chain: 0xBURNER → USDC → Unlink shielded pool
Privacy:  Balance is now in a ZK-shielded pool — invisible to observers
```

### Step 9: Withdraw to Any Wallet

From the shielded pool, the user can withdraw to **any wallet address** — not necessarily the one they originally connected with.

```
Frontend: withdraw([{ token: USDC, amount, recipient: "0xFRESH_WALLET" }])
Privacy:  No on-chain connection between 0xBURNER and 0xFRESH_WALLET
```

---

## What an On-Chain Observer Sees

```
Transaction 1: 0xBURNER approves ShadowOdds for 50 USDC
Transaction 2: 0xBURNER places bet — 50 USDC, commitment hash 0xABC...
Transaction 3: (after resolution) 0xBURNER reveals — direction: YES
Transaction 4: 0xBURNER claims — receives 95 USDC
Transaction 5: 0xBURNER sends USDC to Unlink pool

Later: 0xFRESH_WALLET withdraws 95 USDC from Unlink pool
```

**The observer cannot determine:**
- Who controls 0xBURNER
- That 0xFRESH_WALLET is the same person as 0xBURNER
- The total profit across multiple bets

---

## Dashboard Integration

The **Dashboard** page shows both normal and anonymous bets:

- **My Bets** — bets from your connected wallet, with standard reveal/claim buttons
- **Anonymous Bets** — bets from your burner wallet, with:
  - Reveal button (sends tx from burner via `burnerSend`)
  - Claim button (sends tx from burner via `burnerSend`)
  - Sweep button (returns all USDC to shielded pool)
  - Burner address display with USDC and MON balances

---

## Data Storage

Commitments (secret, nonce, direction) are stored in **localStorage** under the key:

```
shadowodds:bet:{marketId}:{bettorAddress}
```

If the user clears localStorage or switches browsers, they lose the ability to reveal their bet and forfeit their stake. This is a known trade-off for client-side privacy — the secret never touches a server.

---

## Security Considerations

| Risk | Mitigation |
|------|-----------|
| Gas funding links connected wallet to burner | Fixed 0.05 MON amount; indistinguishable from any wallet-to-wallet transfer |
| localStorage loss = lost bet | Warning shown in UI; future: encrypted backup to Unlink |
| Single burner across markets | Acceptable for hackathon; production would use per-market burners |
| Burner key in browser memory | Standard for all browser wallets; Unlink SDK handles key management |

---

## Code References

| File | Purpose |
|------|---------|
| `frontend/src/components/PrivateAdapter.tsx` | Full anonymous betting UI + lifecycle |
| `frontend/src/lib/shadowodds.ts` | `createCommitment`, `saveCommitment`, `loadCommitment` |
| `frontend/src/app/dashboard/page.tsx` | Dashboard with burner bet management |
| `contracts/src/ShadowOdds.sol` | `placeBet`, `revealBet`, `claimWinnings` |
