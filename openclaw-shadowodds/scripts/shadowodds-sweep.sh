#!/usr/bin/env bash
# shadowodds-sweep
# Print instructions for sweeping burner wallet winnings back into Unlink pool
# (Unlink sweep is done via the Unlink SDK / frontend — this script guides the agent)
set -euo pipefail

URL="${SHADOWODDS_SERVICE_URL:-http://localhost:3002}"

response=$(curl -sf "$URL/status" 2>&1) || {
  echo "ERROR: ShadowOdds service not running at $URL"
  exit 1
}

address=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['address'])")
usdc=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['balance']['usdc'])")

echo "=== Sweep Burner Wallet to Unlink Pool ==="
echo ""
echo "Burner address : $address"
echo "USDC to sweep  : \$$usdc"
echo ""
echo "To complete the privacy sweep:"
echo "  1. Go to ShadowOdds -> Privacy Suite"
echo "  2. Connect burner wallet (import private key from agent.db)"
echo "  3. Click 'Shield winnings' to deposit \$$usdc into Unlink pool"
echo "  4. Withdraw from Unlink pool to any fresh address"
echo ""
echo "This breaks the on-chain link between your burner wallet and your winnings."
echo ""
echo "Alternatively, use the Unlink SDK directly:"
echo "  import { useWithdraw } from '@unlink-xyz/react'"
echo "  await withdraw({ to: freshAddress, amount: '$usdc', token: 'USDC' })"
