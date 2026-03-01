import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  encodePacked,
  defineChain,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "crypto";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz"] },
  },
});

export const SHADOW_ODDS_ADDRESS = (
  process.env.SHADOW_ODDS_ADDRESS ?? ""
) as Address;

export const USDC_ADDRESS = (
  process.env.USDC_ADDRESS ?? "0xE557929407b3EACb89CfF69F46D3Dfcb81724615"
) as Address;

// Minimal ERC-20 ABI for approve + balanceOf
const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const SHADOW_ODDS_ABI = [
  {
    name: "marketCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
  {
    name: "bets",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [
      { name: "commitment", type: "bytes32" },
      { name: "lockedAmount", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "revealed", type: "bool" },
      { name: "claimed", type: "bool" },
    ],
  },
  {
    name: "placeBet",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "commitment", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "revealBet",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "outcome", type: "uint8" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "claimWinnings",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
] as const;

export function createClients(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const transport = http(process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz");

  const publicClient = createPublicClient({ chain: monadTestnet, transport });
  const walletClient = createWalletClient({ chain: monadTestnet, transport, account });

  return { account, publicClient, walletClient };
}

export interface MarketData {
  id: number;
  question: string;
  bettingDeadline: bigint;
  resolutionTime: bigint;
  revealDeadline: bigint;
  resolved: boolean;
  result: number;
  totalPool: bigint;
  yesPool: bigint;
  noPool: bigint;
  status: "betting" | "pending" | "reveal" | "resolved";
}

export async function getMarkets(publicClient: ReturnType<typeof createPublicClient>): Promise<MarketData[]> {
  const count = await publicClient.readContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: SHADOW_ODDS_ABI,
    functionName: "marketCount",
  });

  const now = BigInt(Math.floor(Date.now() / 1000));
  const markets: MarketData[] = [];

  for (let i = 1; i <= Number(count); i++) {
    const m = await publicClient.readContract({
      address: SHADOW_ODDS_ADDRESS,
      abi: SHADOW_ODDS_ABI,
      functionName: "markets",
      args: [BigInt(i)],
    });

    let status: MarketData["status"] = "betting";
    if (m[9] && now >= m[3]) status = "resolved";
    else if (m[9]) status = "reveal";
    else if (now >= m[1]) status = "pending";

    markets.push({
      id: i,
      question: m[0],
      bettingDeadline: m[1],
      resolutionTime: m[2],
      revealDeadline: m[3],
      resolved: m[9],
      result: m[8],
      totalPool: m[10],
      yesPool: m[11],
      noPool: m[12],
      status,
    });
  }

  return markets;
}

export function generateCommitment(outcome: number, amountUsdc: string) {
  const secret = `0x${randomBytes(32).toString("hex")}` as Hex;
  const nonce = BigInt(`0x${randomBytes(8).toString("hex")}`);
  const amount = parseUnits(amountUsdc, 6);

  const commitment = keccak256(
    encodePacked(["bytes32", "uint8", "uint256", "uint256"], [secret, outcome, amount, nonce])
  );

  return { secret, nonce, amount, commitment };
}

export async function getUsdcBalance(
  publicClient: ReturnType<typeof createPublicClient>,
  address: Address
): Promise<string> {
  const raw = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  return formatUnits(raw, 6);
}

export async function placeBet(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient> & { account: ReturnType<typeof privateKeyToAccount> },
  marketId: number,
  commitment: Hex,
  amount: bigint
): Promise<Hex> {
  // 1. Approve USDC
  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [walletClient.account.address, SHADOW_ODDS_ADDRESS],
  });

  if (allowance < amount) {
    const approveTx = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [SHADOW_ODDS_ADDRESS, amount],
      chain: monadTestnet,
      account: walletClient.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  // 2. Place bet
  const hash = await walletClient.writeContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: SHADOW_ODDS_ABI,
    functionName: "placeBet",
    args: [BigInt(marketId), commitment, amount],
    chain: monadTestnet,
    account: walletClient.account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function revealBet(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient> & { account: ReturnType<typeof privateKeyToAccount> },
  marketId: number,
  secret: Hex,
  outcome: number,
  amount: bigint,
  nonce: bigint
): Promise<Hex> {
  const hash = await walletClient.writeContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: SHADOW_ODDS_ABI,
    functionName: "revealBet",
    args: [BigInt(marketId), secret, outcome, amount, nonce],
    chain: monadTestnet,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function claimWinnings(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient> & { account: ReturnType<typeof privateKeyToAccount> },
  marketId: number
): Promise<Hex> {
  const hash = await walletClient.writeContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: SHADOW_ODDS_ABI,
    functionName: "claimWinnings",
    args: [BigInt(marketId)],
    chain: monadTestnet,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function getOnChainBet(
  publicClient: ReturnType<typeof createPublicClient>,
  marketId: number,
  address: Address
) {
  return publicClient.readContract({
    address: SHADOW_ODDS_ADDRESS,
    abi: SHADOW_ODDS_ABI,
    functionName: "bets",
    args: [BigInt(marketId), address],
  });
}

export { formatUnits, parseUnits };
