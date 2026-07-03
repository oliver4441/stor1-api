#!/bin/bash
# Monthly affiliate commission calc - runs via Hermes cron
# Uses Supabase service key directly (no Render deploy dependency)
# Set on Render: 1st of every month at 02:00 UTC

set -euo pipefail

# Load Supabase credentials
SKEY=$(python3 -c 'import json;print(json.load(open("/root/.supabase_creds.json"))["service_key"])')
SUPABASE_URL="https://fdwoezyataxhdtgjlfxt.supabase.co"

# Default: calculate for previous month
YEAR=${1:-$(date -d "1 month ago" +%Y)}
MONTH=${2:-$(date -d "1 month ago" +%m)}

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running commission calc for ${YEAR}-${MONTH}..."

# Step 1: Cleanly strip leading 0 from month
MONTH=$((10#$MONTH))

# Run the PG function via exec_sql RPC (creates commission records)
curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SKEY}" \
  -H "Authorization: Bearer *** \
  -d "$(python3 -c "
import json
sql = f'SELECT public.calculate_monthly_commission({YEAR}, {MONTH});'
print(json.dumps({'sql': sql}))
")"

# Step 2: Check affiliate dashboard to see if commission data exists
echo
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Commission calculation complete."
echo "Check results at: https://stor1-web.onrender.com/affiliate-dashboard"
