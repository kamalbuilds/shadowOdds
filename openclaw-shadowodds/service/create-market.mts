/**
 * Creates a new ADMIN oracle market on ShadowOdds for demo purposes.
 * Usage: DEPLOYER_KEY=0x... tsx create-market.mts [bettingWindowSeconds]
 */
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEPLOYER_KEY = (process.env.DEPLOYER_KEY ?? "") as `0x${string}`;
if (!DEPLOYER_KEY) {
  console.error("Usage: DEPLOYER_KEY=0x... tsx create-market.mts [bettingWindowSeconds]");
  process.exit(1);
}

const SHADOW_ODDS = (process.env.SHADOW_ODDS_ADDRESS ?? "0x62497bB63802cf7CEe9180BCB7229fB7a69d37c0") as `0x${string}`;
const bettingWindowSecs = Number(process.argv[2] ?? "300"); // default 5 min

const monad = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz"] } },
});

const abi = [
  {
    name: "createMarket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "question", type: "string" },
      { name: "bettingDeadline", type: "uint256" },
      { name: "resolutionTime", type: "uint256" },
      { name: "oracleType", type: "uint8" },
      { name: "priceOracle", type: "address" },
      { name: "priceFeedId", type: "bytes32" },
      { name: "priceThreshold", type: "int64" },
    ],
    outputs: [{ name: "marketId", type: "uint256" }],
  },
  {
    name: "marketCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const account = privateKeyToAccount(DEPLOYER_KEY);
const transport = http(process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz");
const publicClient = createPublicClient({ chain: monad, transport });
const walletClient = createWalletClient({ chain: monad, transport, account });

const now = Math.floor(Date.now() / 1000);
const deadline = BigInt(now + bettingWindowSecs);
const resolutionTime = deadline; // resolve immediately after betting closes

console.log(`Creating ADMIN oracle market...`);
console.log(`  Betting deadline: ${new Date((now + bettingWindowSecs) * 1000).toISOString()} (+${bettingWindowSecs}s)`);
console.log(`  Resolution time:  ${new Date((now + bettingWindowSecs) * 1000).toISOString()}`);

const hash = await walletClient.writeContract({
  address: SHADOW_ODDS,
  abi,
  functionName: "createMarket",
  args: [
    "Will ShadowOdds win the hackathon? (ADMIN DEMO)",
    deadline,
    resolutionTime,
    0, // OracleType.ADMIN
    "0x0000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    0n,
  ],
  chain: monad,
  account,
});

console.log(`Tx: ${hash}`);
await publicClient.waitForTransactionReceipt({ hash });

const count = await publicClient.readContract({
  address: SHADOW_ODDS,
  abi,
  functionName: "marketCount",
});

console.log(`\n✅ Market created!`);
console.log(`   Market ID: ${Number(count)}`);
console.log(`   Bet on it: curl -X POST http://localhost:3002/bet -H "Content-Type: application/json" -d '{"marketId": ${Number(count)}, "outcome": "YES", "amount": "10"}'`);
console.log(`   Resolve:   DEPLOYER_KEY=0x... tsx resolve-market.mts ${Number(count)}`);
