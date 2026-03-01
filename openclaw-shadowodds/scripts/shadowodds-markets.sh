#!/usr/bin/env bash
# shadowodds-markets — list all open prediction markets with pool sizes
set -euo pipefail

URL="${SHADOWODDS_SERVICE_URL:-http://localhost:3002}"

response=$(curl -sf "$URL/markets" 2>&1) || {
  echo "ERROR: ShadowOdds service not running at $URL"
  exit 1
}

echo "=== ShadowOdds Markets ==="
echo ""

python3 - <<EOF
import sys, json

data = json.loads("""$response""")
markets = data.get('markets', [])

if not markets:
    print("No markets found.")
    sys.exit(0)

for m in markets:
    status_icon = {
        "betting": "[OPEN]",
        "pending": "[PENDING]",
        "reveal": "[REVEAL]",
        "resolved": "[DONE]",
    }.get(m['status'], '[?]')

    print(f"Market #{m['id']} {status_icon}")
    print(f"  Question   : {m['question']}")
    print(f"  Status     : {m['status']}")
    print(f"  Deadline   : {m['bettingDeadline']}")
    print(f"  Total Pool : \${m['totalPool']}")
    print(f"  YES / NO   : \${m['yesPool']} / \${m['noPool']}")
    if m['resolved']:
        print(f"  Result     : {m['result']}")
    if m['status'] == 'betting':
        secs = m['secondsLeft']
        if secs < 60:
            print(f"  Time left  : {secs}s")
        elif secs < 3600:
            print(f"  Time left  : {secs // 60}m {secs % 60}s")
        else:
            print(f"  Time left  : {secs // 3600}h {(secs % 3600) // 60}m")
    print()
EOF
