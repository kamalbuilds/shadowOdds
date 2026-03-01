import { createConfig, http } from "wagmi";
import { defineChain } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
});

export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://monadexplorer.com" },
  },
});

export const config = createConfig({
  chains: [monadTestnet, monadMainnet],
  transports: {
    [monadTestnet.id]: http(),
    [monadMainnet.id]: http(),
  },
});

// Contract addresses — update after deploy
export const SHADOW_ODDS_ADDRESS = (process.env.NEXT_PUBLIC_SHADOW_ODDS_ADDRESS ?? "") as `0x${string}`;
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0xE557929407b3EACb89CfF69F46D3Dfcb81724615") as `0x${string}`;
export const PYTH_ADDRESS = (process.env.NEXT_PUBLIC_PYTH_ADDRESS ?? "0x2880aB155794e7179c9eE2e38200202908C17B43") as `0x${string}`;

// Pyth price feed IDs (all expo=-8)
export const PYTH_FEEDS: Record<string, { symbol: string; name: string; expo: number }> = {
  "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace": { symbol: "ETH", name: "Ethereum", expo: -8 },
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43": { symbol: "BTC", name: "Bitcoin", expo: -8 },
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d": { symbol: "SOL", name: "Solana", expo: -8 },
  "0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c": { symbol: "DOGE", name: "Dogecoin", expo: -8 },
  "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1": { symbol: "MON", name: "Monad", expo: -8 },
  "0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221": { symbol: "LINK", name: "Chainlink", expo: -8 },
};
export const ETH_USD_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
export const PYTH_HERMES_URL = "https://hermes.pyth.network";

/** Resolve a Pyth feed ID to its asset info */
export function feedInfo(feedId: string) {
  const id = feedId.toLowerCase();
  return PYTH_FEEDS[id] ?? { symbol: "???", name: "Unknown", expo: -8 };
}

// Pyth price exponents (for display conversion)
// ETH/USD on Pyth uses expo=-8, so threshold/price * 10^8 = raw value
export const PYTH_ETH_EXPO = -8;

// Unlink privacy pool (Monad testnet)
export const UNLINK_POOL_ADDRESS = "0x0813da0a10328e5ed617d37e514ac2f6fa49a254" as `0x${string}`;
