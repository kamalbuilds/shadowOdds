#!/usr/bin/env bash
# shadowodds-status — show burner wallet address, USDC balance, and pending bets
set -euo pipefail

URL="${SHADOWODDS_SERVICE_URL:-http://localhost:3002}"

response=$(curl -sf "$URL/status" 2>&1) || {
  echo "ERROR: ShadowOdds service not running at $URL"
  echo "Start it: cd service && npm start"
  exit 1
}

address=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['address'])")
usdc=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['balance']['usdc'])")
mon=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['balance']['mon'])")
pending=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['pendingBets'])")
contract=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['contract'] or '(not configured)')")

echo "=== ShadowOdds Agent Status ==="
echo "Burner address : $address"
echo "USDC balance   : \$$usdc"
echo "MON balance    : $mon MON (for gas)"
echo "Pending bets   : $pending"
echo "Contract       : $contract"
echo ""
echo "To fund this wallet, send USDC via Unlink to: $address"
