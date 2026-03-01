# PrivateX Contracts

Private AI Agent Payment Network — built on Monad + x402.

## Network

| | Value |
|--|--|
| Chain | Monad Mainnet |
| Chain ID | 143 |
| RPC | https://rpc.monad.xyz |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Explorer | https://monadscan.com |
| x402 chain key | `"eip155:143"` / `"monad"` |

## Contracts

| Contract | Description |
|----------|-------------|
| `AgentRegistry` | Register AI agents with endpoints + metadata |
| `AgentVault` | Holds USDC balances for agents, handles deposits/withdrawals |
| `PrivateSettlement` | Commitment/nullifier scheme for private payer-agent payments |
| `x402Verifier` | On-chain EIP-3009 settlement for x402 HTTP payment protocol |

## Setup

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install foundry-rs/forge-std

# Copy env
cp .env.example .env
# Fill in PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET
```

## Build & Test

```bash
forge build
forge test
```

## Deploy

```bash
# Monad Mainnet
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.monad.xyz \
  --broadcast \
  --verify \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org

# Monad Testnet (no x402 native support — demo only)
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.monad.xyz \
  --broadcast
```

## x402 Integration

```typescript
import { createPaymentMiddleware } from "@coinbase/x402-next";

// Protect an API route with x402 payment
export const middleware = createPaymentMiddleware({
  amount: "0.01",        // 0.01 USDC per request
  asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  network: "eip155:143", // Monad Mainnet
  payTo: AGENT_ADDRESS,
});
```

## Architecture

```
Client → HTTP Request → Agent Endpoint
                           ↓ (402 Payment Required)
Client ← Payment Challenge ←
           ↓ (sign EIP-3009 auth)
Client → X-PAYMENT header →
                           ↓
                    x402Verifier.settle()
                           ↓
                    AgentVault.deposit(agent, amount)
                           ↓
Agent fulfills request ← Payment confirmed
```
