#!/usr/bin/env bash
# shadowodds-claim <marketId>
# Claim winnings after revealing a winning bet
set -euo pipefail

URL="${SHADOWODDS_SERVICE_URL:-http://localhost:3002}"

if [[ $# -lt 1 ]]; then
  echo "Usage: shadowodds-claim <marketId>"
  exit 1
fi

MARKET_ID="$1"

echo "Claiming winnings for market #$MARKET_ID..."

response=$(curl -sf -X POST "$URL/claim" \
  -H "Content-Type: application/json" \
  -d "{\"marketId\": $MARKET_ID}" 2>&1) || {
  echo "ERROR: $response"
  exit 1
}

python3 - <<EOF
import json, sys

d = json.loads("""$response""")
if not d.get('ok'):
    print(f"ERROR: {d.get('error', 'unknown error')}")
    sys.exit(1)

print(f"Winnings claimed!")
print(f"  Tx hash        : {d['txHash']}")
print(f"  New USDC balance: \${d['newUsdcBalance']}")
print()
print("Run 'shadowodds-sweep' to move winnings back to Unlink pool for privacy.")
EOF
