/**
 * Resolves an ADMIN oracle market on ShadowOdds.
 * Usage: DEPLOYER_KEY=0x... tsx resolve-market.mts <marketId> [YES|NO]
 */
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEPLOYER_KEY = (process.env.DEPLOYER_KEY ?? "") as `0x${string}`;
const marketId = Number(process.argv[2]);
const resultArg = (process.argv[3] ?? "YES").toUpperCase();

if (!DEPLOYER_KEY || !marketId) {
  console.error("Usage: DEPLOYER_KEY=0x... tsx resolve-market.mts <marketId> [YES|NO]");
  process.exit(1);
}
if (resultArg !== "YES" && resultArg !== "NO") {
  console.error("Result must be YES or NO");
  process.exit(1);
}

const SHADOW_ODDS = (process.env.SHADOW_ODDS_ADDRESS ?? "0x62497bB63802cf7CEe9180BCB7229fB7a69d37c0") as `0x${string}`;

const monad = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz"] } },
});

const abi = [
  {
    name: "resolveAdmin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "result", type: "uint8" },
    ],
    outputs: [],
  },
  {
    name: "markets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "question", type: "string" },
      { name: "bettingDeadline", type: "uint256" },
      { name: "resolutionTime", type: "uint256" },
      { name: "revealDeadline", type: "uint256" },
      { name: "oracleType", type: "uint8" },
      { name: "priceOracle", type: "address" },
      { name: "priceFeedId", type: "bytes32" },
      { name: "priceThreshold", type: "int64" },
      { name: "result", type: "uint8" },
      { name: "resolved", type: "bool" },
      { name: "totalPool", type: "uint256" },
      { name: "yesPool", type: "uint256" },
      { name: "noPool", type: "uint256" },
    ],
  },
] as const;

const result = resultArg === "YES" ? 1 : 2; // Outcome.YES=1, Outcome.NO=2

const account = privateKeyToAccount(DEPLOYER_KEY);
const transport = http(process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz");
const publicClient = createPublicClient({ chain: monad, transport });
const walletClient = createWalletClient({ chain: monad, transport, account });

// Check market info first
const m = await publicClient.readContract({
  address: SHADOW_ODDS,
  abi,
  functionName: "markets",
  args: [BigInt(marketId)],
});

const now = Math.floor(Date.now() / 1000);
const resolutionTime = Number(m[2]);
const oracleType = m[4]; // 0=ADMIN, 1=PRICE_FEED

console.log(`Market #${marketId}: "${m[0]}"`);
console.log(`  Oracle type:     ${oracleType === 0 ? "ADMIN ✓" : "PRICE_FEED ✗"}`);
console.log(`  Resolution time: ${new Date(resolutionTime * 1000).toISOString()}`);
console.log(`  Current time:    ${new Date(now * 1000).toISOString()}`);
console.log(`  Resolved:        ${m[9]}`);

if (oracleType !== 0) {
  console.error("\n❌ Market is not an ADMIN oracle market — cannot use resolveAdmin");
  process.exit(1);
}
if (m[9]) {
  console.error("\n❌ Market is already resolved");
  process.exit(1);
}
if (now < resolutionTime) {
  const wait = resolutionTime - now;
  console.error(`\n❌ Too early to resolve. Wait ${wait} more seconds (until ${new Date(resolutionTime * 1000).toISOString()})`);
  process.exit(1);
}

console.log(`\nResolving market #${marketId} as ${resultArg}...`);

const hash = await walletClient.writeContract({
  address: SHADOW_ODDS,
  abi,
  functionName: "resolveAdmin",
  args: [BigInt(marketId), result],
  chain: monad,
  account,
});

console.log(`Tx: ${hash}`);
await publicClient.waitForTransactionReceipt({ hash });
console.log(`\n✅ Market #${marketId} resolved as ${resultArg}!`);
console.log(`   Reveal: curl -X POST http://localhost:3002/reveal -H "Content-Type: application/json" -d '{"marketId": ${marketId}}'`);
console.log(`   Claim:  curl -X POST http://localhost:3002/claim  -H "Content-Type: application/json" -d '{"marketId": ${marketId}}'`);
