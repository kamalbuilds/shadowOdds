#!/usr/bin/env bash
# shadowodds-pending — show all active bets and what action is needed
set -euo pipefail

URL="${SHADOWODDS_SERVICE_URL:-http://localhost:3002}"

response=$(curl -sf "$URL/pending" 2>&1) || {
  echo "ERROR: ShadowOdds service not running at $URL"
  exit 1
}

echo "=== Pending Bets ==="
echo ""

python3 - <<EOF
import json, sys

d = json.loads("""$response""")
bets = d.get('bets', [])

if not bets:
    print("No pending bets.")
    sys.exit(0)

for bet in bets:
    action_map = {
        "wait": "Wait for market to resolve",
        "reveal": f"READY TO REVEAL -> shadowodds-reveal {bet['marketId']}",
        "claim": f"READY TO CLAIM  -> shadowodds-claim {bet['marketId']}",
        "done": "Completed",
    }
    print(f"Market #{bet['marketId']}")
    print(f"  Question : {bet['question']}")
    print(f"  Your bet : {bet['outcome']} — \${bet['amount']} USDC")
    print(f"  Status   : {bet['status']}")
    print(f"  Action   : {action_map.get(bet['action'], bet['action'])}")
    print()
EOF
