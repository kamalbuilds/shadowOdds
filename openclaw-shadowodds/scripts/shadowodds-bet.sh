#!/usr/bin/env bash
# shadowodds-bet <marketId> <YES|NO> <amount>
# Place a private bet on a ShadowOdds market using your Unlink-funded burner wallet
set -euo pipefail

URL="${SHADOWODDS_SERVICE_URL:-http://localhost:3002}"

if [[ $# -lt 3 ]]; then
  echo "Usage: shadowodds-bet <marketId> <YES|NO> <amount>"
  echo "  Example: shadowodds-bet 3 YES 10"
  exit 1
fi

MARKET_ID="$1"
OUTCOME="$2"
AMOUNT="$3"

echo "Placing bet: market #$MARKET_ID — $OUTCOME — \$$AMOUNT USDC"
echo "Using Unlink-funded burner wallet for privacy..."
echo ""

response=$(curl -sf -X POST "$URL/bet" \
  -H "Content-Type: application/json" \
  -d "{\"marketId\": $MARKET_ID, \"outcome\": \"$OUTCOME\", \"amount\": \"$AMOUNT\"}" 2>&1) || {
  echo "ERROR: $response"
  exit 1
}

python3 - <<EOF
import json, sys

d = json.loads("""$response""")
if not d.get('ok'):
    print(f"ERROR: {d.get('error', 'unknown error')}")
    sys.exit(1)

print(f"Bet placed successfully!")
print(f"  Market     : #{d['marketId']}")
print(f"  Outcome    : {d['outcome']}")
print(f"  Amount     : \${d['amount']} USDC")
print(f"  Commitment : {d['commitment'][:20]}...")
print(f"  Tx hash    : {d['txHash']}")
print()
print("Your bet direction is hidden on-chain (commit-reveal).")
print("Run 'shadowodds-pending' to monitor this bet.")
print(f"Next: reveal when market resolves -> 'shadowodds-reveal {d['marketId']}'")
EOF
