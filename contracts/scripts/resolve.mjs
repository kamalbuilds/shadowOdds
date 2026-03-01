#!/usr/bin/env node
/**
 * resolve.mjs — Fetch live Pyth price and resolve a ShadowOdds market
 * Usage: node scripts/resolve.mjs <marketId>
 *
 * Requires: PRIVATE_KEY in env
 */

import { createWalletClient, createPublicClient, http, parseAbi, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

const SHADOW_ODDS = "0xF62f9b730A1771E098FDe4C96aE987Bfce77f4DA";
const ETH_USD_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const HERMES_URL = "https://hermes.pyth.network/v2/updates/price/latest";

const ABI = parseAbi([
  "function resolveWithPyth(uint256 marketId, bytes[] calldata pythUpdateData) external payable",
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
  "function markets(uint256) external view returns (string,uint256,uint256,uint256,uint8,address,bytes32,int64,uint8,bool,uint256,uint256,uint256)",
]);

const PYTH_ABI = parseAbi([
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
]);

async function main() {
  const marketId = BigInt(process.argv[2] ?? "4");
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY env var required");

  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http() });

  console.log(`\n=== ShadowOdds Pyth Resolver ===`);
  console.log(`Market ID:  ${marketId}`);
  console.log(`Wallet:     ${account.address}`);

  // 1. Fetch live Pyth VAA from Hermes
  const hermesRes = await fetch(`${HERMES_URL}?ids[]=${ETH_USD_FEED}&encoding=hex`);
  const hermesData = await hermesRes.json();
  const vaaHex = hermesData.binary.data[0];
  const parsed = hermesData.parsed[0];
  const ethPrice = parseFloat(parsed.price.price) * Math.pow(10, parseInt(parsed.price.expo));
  console.log(`\nLive ETH/USD (Pyth Hermes): $${ethPrice.toFixed(2)}`);
  console.log(`VAA size: ${vaaHex.length / 2} bytes`);

  // 2. Check market state
  const market = await publicClient.readContract({
    address: SHADOW_ODDS,
    abi: ABI,
    functionName: "markets",
    args: [marketId],
  });
  const [question, bettingDeadline, resolutionTime, , , , , priceThreshold, , resolved, totalPool] = market;
  const threshold = Number(priceThreshold) / 1e8;
  console.log(`\nMarket: "${question}"`);
  console.log(`Threshold: $${threshold}`);
  console.log(`Total pool: ${Number(totalPool) / 1e6} USDC`);
  console.log(`Resolved: ${resolved}`);

  if (resolved) {
    console.log("Market already resolved!");
    return;
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < resolutionTime) {
    console.log(`\nToo early! Resolution at: ${new Date(Number(resolutionTime) * 1000).toISOString()}`);
    console.log(`Now: ${new Date().toISOString()}`);
    return;
  }

  // 3. Get Pyth update fee
  const updateData = [`0x${vaaHex}`];
  const pythAddr = "0x2880aB155794e7179c9eE2e38200202908C17B43";
  const fee = await publicClient.readContract({
    address: pythAddr,
    abi: PYTH_ABI,
    functionName: "getUpdateFee",
    args: [updateData],
  });
  console.log(`\nPyth update fee: ${fee} wei`);

  const expectedOutcome = ethPrice >= threshold ? "YES" : "NO";
  console.log(`Expected outcome: ${expectedOutcome} (ETH $${ethPrice.toFixed(2)} vs threshold $${threshold})`);

  // 4. Resolve!
  console.log(`\nResolving market ${marketId} with live Pyth data...`);
  const txHash = await walletClient.writeContract({
    address: SHADOW_ODDS,
    abi: ABI,
    functionName: "resolveWithPyth",
    args: [marketId, updateData],
    value: fee,
  });

  console.log(`TX: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`Status: ${receipt.status}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`\nMarket ${marketId} resolved ${expectedOutcome} via live Pyth oracle!`);
}

main().catch(console.error);
