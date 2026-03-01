#!/usr/bin/env bash
# shadowodds-reveal <marketId>
# Reveal your bet direction after the market resolves
set -euo pipefail

URL="${SHADOWODDS_SERVICE_URL:-http://localhost:3002}"

if [[ $# -lt 1 ]]; then
  echo "Usage: shadowodds-reveal <marketId>"
  exit 1
fi

MARKET_ID="$1"

echo "Revealing bet for market #$MARKET_ID..."

response=$(curl -sf -X POST "$URL/reveal" \
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

won = d['won']
print(f"Bet revealed!")
print(f"  Your outcome   : {d['yourOutcome']}")
print(f"  Market result  : {d['marketResult']}")
print(f"  You won        : {'YES 🎉' if won else 'No'}")
print(f"  Tx hash        : {d['txHash']}")
print()
if won:
    print(f"Next: shadowodds-claim {d['marketId']}")
else:
    print("Better luck next time. No winnings to claim.")
EOF
